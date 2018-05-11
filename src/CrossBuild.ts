import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import * as helper from './helper';

import { BuildConfig } from './BuildConfig';
import { IBuildConfig, IUserTaskDefinition, ITargetPickItem } from './interface';

const commandNames = [
  'editConfigCommand', /*'excludeDirCommand', 'excludeFileCommand',*/ 'showTargetListCommand'
];

const taskType = 'cross';
const buildScriptPath = path.normalize(path.join(path.dirname(__filename), 'build.js'));


export class CrossBuild implements vscode.Disposable {
  public isInitialized: boolean = false;

  private taskProvider: vscode.Disposable;
  private statusBarItem: vscode.StatusBarItem;
  private workspaceRoot: string;

  private configFileWatcher: vscode.FileSystemWatcher;

  private buildConfig: BuildConfig;
  private tcfFilePath: string;
  private selectedTarget: string | undefined;
  private selectedConfig: string | undefined;

  constructor(context: vscode.ExtensionContext) {
    // console.log('CrossBuild: activated');

    // subscribe for config change events
    vscode.workspace.onDidChangeConfiguration(_ => this.extensionConfigurationChanged());

    // register commands
    commandNames.forEach(name => {
      context.subscriptions.push(
        vscode.commands.registerCommand(`CrossBuild.${name}`, this[name], this)
      );
    });

    // init if enabled
    this.initServices();
  }

  async initServices(): Promise<void> {
    const isEnabled = await vscode.workspace.getConfiguration('crossbuild').get<boolean>('enable');
    if (!isEnabled || this.isInitialized) return;

    this.workspaceRoot = vscode.workspace.rootPath;
    if (!this.workspaceRoot) return;

    const configFilePath = path.join(this.workspaceRoot, '.vscode', 'crossbuild.json');
    this.buildConfig = new BuildConfig(this.workspaceRoot, configFilePath, true);
    this.buildConfig.on('changed', _ => this.configFileChanged());

    this.tcfFilePath = path.join(os.tmpdir(), helper.md5(this.workspaceRoot) + '.tcf.json');

    this.taskProvider = vscode.workspace.registerTaskProvider(taskType, {
        provideTasks: async _ => await this.getTasks(),
        resolveTask: (_task: vscode.Task): vscode.Task | undefined => undefined
    });

    this.configFileWatcher = vscode.workspace.createFileSystemWatcher(configFilePath);
    this.configFileWatcher.onDidChange(this.buildConfig.reloadConfigFile, this.buildConfig);
    this.configFileWatcher.onDidCreate(this.buildConfig.reloadConfigFile, this.buildConfig);
    this.configFileWatcher.onDidDelete(this.buildConfig.reloadConfigFile, this.buildConfig);

    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, -1);
    this.statusBarItem.command = 'CrossBuild.showTargetListCommand';
    this.statusBarItem.text = `Build: (no target)`;
    this.statusBarItem.show();

    this.isInitialized = true;
    // console.log('CrossBuild: initialized');
  }

  async disposeServices(): Promise<void> {
    const isEnabled = await vscode.workspace.getConfiguration('crossbuild').get<boolean>('enable');
    if (isEnabled || !this.isInitialized) return;

    this.taskProvider.dispose();
    this.taskProvider = undefined;

    this.configFileWatcher.dispose();
    this.configFileWatcher = undefined;

    this.statusBarItem.dispose();
    this.statusBarItem = undefined;

    this.isInitialized = false;
    // console.log('CrossBuild: disposed');
  }

  dispose() {
    if (this.taskProvider) this.taskProvider.dispose();
    if (this.configFileWatcher) this.configFileWatcher.dispose();
  }

  async getTasks(): Promise<vscode.Task[]> {
    const tasks: vscode.Task[] = [];

    if (this.isInitialized && this.buildConfig.getTargetNames().length > 0) {

      const nodePath = await vscode.workspace.getConfiguration('crossbuild').get<string>('nodePath');
      const ninjaPath = await vscode.workspace.getConfiguration('crossbuild').get<string>('ninjaPath');

      const buildTaksKind: IUserTaskDefinition = { type: taskType, command: 'build' }
      const buildTask = new vscode.Task(buildTaksKind, 'Build', 'CrossBuild',
        new vscode.ShellExecution(`${nodePath} ${buildScriptPath} --ninja ${ninjaPath} --tcfpath ${this.tcfFilePath}`), '$gcc');
      buildTask.group = vscode.TaskGroup.Build;
      buildTask.presentationOptions = { echo: false };
      tasks.push(buildTask);

      const cleanTaksKind: IUserTaskDefinition = { type: taskType, command: 'clean' }
      const cleanTask = new vscode.Task(cleanTaksKind, 'Clean', 'CrossBuild',
        new vscode.ShellExecution(`${nodePath} ${buildScriptPath} --tcfpath ${this.tcfFilePath} --clean`), []);
      cleanTask.group = vscode.TaskGroup.Clean;
      cleanTask.presentationOptions = { echo: false };
      tasks.push(cleanTask);

    }

    return tasks;
  }

  async setTarget(targetName?: string, configName?: string): Promise<void> {
    if (targetName === this.selectedTarget && configName === this.selectedConfig) {
      await this.generateVsCCppProperties();
      return;
    }

    this.selectedTarget = targetName;
    this.selectedConfig = configName;

    if (targetName && configName) {
      this.statusBarItem.text = `${targetName} | ${configName}`;
    }
    else {
      this.statusBarItem.text = `Build: (no target)`;
    }

    await helper.writeFileContent(this.tcfFilePath, '{ "target": "' + (targetName || '') + '", "config": "' + (configName || '') + '"}\n');
    await this.generateVsCCppProperties();
  }

  async generateVsCCppProperties(): Promise<void> {
    const generateVsCCpp = await vscode.workspace.getConfiguration('crossbuild').get<boolean>('generateVsCCppProperties');
    if (!generateVsCCpp)  return;

    const vsCCppDefines = await vscode.workspace.getConfiguration('crossbuild').get<Array<string>>('vsCCppExtraDefines');
    const spaces = await vscode.workspace.getConfiguration('editor').get<number>('tabSize');

    const filePath = path.join(path.dirname(this.buildConfig.configFilePath), 'c_cpp_properties.json');
    let includePath: string[] = [];
    let defines: string[] = [];

    if (this.selectedTarget && this.selectedConfig) {
      const target = this.buildConfig.getTarget(this.selectedTarget);
      const targetConfig = this.buildConfig.getConfigurationForTarget(this.selectedTarget, this.selectedConfig);
      if (targetConfig) {
        includePath = (targetConfig.includePaths || []).map(item => {
          if (!path.isAbsolute(item)) item = path.join(target.sourceRoot || '', item);
          item = path.resolve(item).replace(this.workspaceRoot, '${workspaceRoot}');
          return item;
        });
        defines = targetConfig.defines || [];
      }
    }

    if (Array.isArray(vsCCppDefines) && vsCCppDefines.length > 0) {
      defines = vsCCppDefines.concat(defines);
    }

    const data = {
      version: 2,
      configurations: [
        {
          intelliSenseMode: process.platform === 'win32' ? 'mscv-x64' : 'clang-x64',
          name: 'Auto',
          includePath,
          defines,
          browse: { path: includePath }
        }
      ]
    };

    const dataStr = JSON.stringify(data, null, spaces || 4) + '\n';
    let currentStr = '';
    try {
      currentStr = await helper.readFileContent(filePath);
    }
    catch(e) {}
    if (currentStr !== dataStr) {
      await helper.writeFileContent(filePath, dataStr);
    }
  }

  async extensionConfigurationChanged(): Promise<void> {
    const isEnabled = await vscode.workspace.getConfiguration('crossbuild').get<boolean>('enable');
    if (isEnabled && !this.isInitialized) {
      await this.initServices();
    }
    else if (!isEnabled && this.isInitialized) {
      await this.disposeServices();
    }

    if (this.isInitialized) {
      await this.generateVsCCppProperties();
    }
  }

  async configFileChanged(): Promise<void> {
    if (!this.isInitialized) return;
    if (!this.selectedTarget || !this.selectedConfig ||
        !this.buildConfig.targetHaveConfiguration(this.selectedTarget, this.selectedConfig, true)) {
      const targetNames = this.buildConfig.getTargetNames(true);
      if (targetNames.length > 0) {
        const target = targetNames[0];
        const configNames = this.buildConfig.getConfigurationNamesForTarget(target, true);
        if (configNames.length > 0) {
          const config = configNames[0];
          return await this.setTarget(target, config);
        }
      }

      return await this.setTarget();
    }

    this.generateVsCCppProperties();
  }

  editConfigCommand(): void {
    if (!this.isInitialized) return;
    this.openConfigFile();
  }

  excludeDirCommand(uri: vscode.Uri): void {
    if (!this.isInitialized) return;
    let path = uri.fsPath;
    if (path.indexOf(this.workspaceRoot) === 0) {
      path = path.substr(this.workspaceRoot.length + 1);
    }
    console.log(path);
  }

  excludeFileCommand(uri: vscode.Uri): void {
    if (!this.isInitialized) return;
    let path = uri.fsPath;
    if (path.indexOf(this.workspaceRoot) === 0) {
      path = path.substr(this.workspaceRoot.length + 1);
    }
    console.log(path);
  }

  async showTargetListCommand(): Promise<void> {
    if (!this.isInitialized) return;

    const items: ITargetPickItem[] = [];
    this.buildConfig.getTargetNames(true).forEach(target => {
      this.buildConfig.getConfigurationNamesForTarget(target, true).forEach(config => {
        items.push({ label: `${target} > ${config}`, description: '', target, config });
      });
    });

    items.push({ label: 'Edit Configurations...', description: '' });
    const result = await vscode.window.showQuickPick(items, { placeHolder: '' });
    if (result) {
      if (result.target && result.config) {
        this.setTarget(result.target, result.config);
      }
      else {
        this.editConfigCommand();
      }
    }
  }

  async openConfigFile(): Promise<void> {
    if (!fs.existsSync(this.buildConfig.configFilePath)) {
      const templatePath = path.normalize(path.join(__dirname, '..', '..', 'configTemplate.json'));
      let template: string;
      try {
        template = await helper.readFileContent(templatePath);
      }
      catch (e) { console.error(e.stack); return; }
      await helper.writeFileContent(this.buildConfig.configFilePath, template);
    }

    const document = await vscode.workspace.openTextDocument(this.buildConfig.configFilePath);
    let foundEditor = false;
    vscode.window.visibleTextEditors.forEach((editor, index, array) => {
      if (editor.document == document) {
        foundEditor = true;
        vscode.window.showTextDocument(document, editor.viewColumn);
      }
    });
    if (!foundEditor) {
      if (vscode.window.activeTextEditor != undefined) {
        vscode.window.showTextDocument(document, vscode.window.activeTextEditor.viewColumn);
      }
      else {
        vscode.window.showTextDocument(document);
      }
    }
  }

}
