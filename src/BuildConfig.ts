// import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as jsonc from 'jsonc-parser';
import * as helper from './helper';

import {EventEmitter} from 'events';
import { IBuildConfig } from './interface';

export class BuildConfig extends EventEmitter
{
  public configFilePath: string;
  public workspaceRoot: string;
  private configObject: IBuildConfig.BuildConfig | undefined;

  private toolchains: IBuildConfig.ToolchainList = {};
  private targets: IBuildConfig.TargetList = {};
  private processOptions: boolean;

  constructor(workspaceRoot: string, configFilePath?: string, processOptions: boolean = false) {
    super();

    this.workspaceRoot = workspaceRoot;
    this.processOptions = processOptions;

    if (configFilePath) {
      this.configFilePath = configFilePath;
      this.reloadConfigFile();
    }
  }

  getToolchainNames(): string[] {
    if (typeof this.toolchains === 'object') {
      return Object.keys(this.toolchains);
    }
    return [];
  }

  getToolchain(toolchainName: string): IBuildConfig.Toolchain | undefined {
    if (typeof this.toolchains === 'object' && typeof this.toolchains[toolchainName] === 'object') {
      return this.toolchains[toolchainName];
    }
    return undefined;
  }

  getTargetNames(filterPrivate: boolean = false): string[] {
    if (typeof this.targets === 'object') {
      return Object.keys(this.targets).filter(val => !filterPrivate || val.charAt(0) !== '_');
    }
    return [];
  }

  getTarget(targetName: string): IBuildConfig.Target | undefined {
    if (typeof this.targets === 'object' && typeof this.targets[targetName] === 'object') {
      return this.targets[targetName];
    }
    return undefined;
  }

  getConfigurationNamesForTarget(targetName: string, filterPrivate: boolean = false): string[] {
    const target = this.getTarget(targetName);
    if (target && typeof target.configurations === 'object') {
      return Object.keys(target.configurations).filter(val => !filterPrivate || val.charAt(0) !== '_');
    }
    return undefined;
  }

  getConfigurationForTarget(targetName: string, configName: string): IBuildConfig.TargetConfiguration | undefined {
    const target = this.getTarget(targetName);
    if (target && typeof target.configurations === 'object') {
      return target.configurations[configName];
    }
    return undefined;
  }

  targetHaveConfiguration(targetName: string, configName: string, filterPrivate: boolean = false): boolean {
    const names = this.getConfigurationNamesForTarget(targetName, filterPrivate);
    return names.indexOf(configName) > -1;
  }

  async reloadConfigFile(): Promise<void> {
    let configFileContent = '';
    try {
      configFileContent = await helper.readFileContent(this.configFilePath);
    } catch(e) {
      // TODO: no config file readable, bail out
      this.updateConfig(undefined);
      return;
    }

    const parseErrors = [];
    const configObj = jsonc.parse(configFileContent, parseErrors);
    this.updateConfig((typeof configObj === 'object' && !Array.isArray(configObj)) ? configObj : undefined);
  }

  private updateConfig(newConfig: IBuildConfig.BuildConfig | undefined) {
    this.configObject = newConfig;

    if (newConfig && typeof newConfig.toolchains === 'object') {
      this.toolchains = newConfig.toolchains;
    }
    else {
      this.toolchains = {};
    }

    if (newConfig && typeof newConfig.targets === 'object') {
      this.targets = newConfig.targets;
    }
    else {
      this.targets = {};
    }

    if (this.processOptions) {

      let env = Object.assign({}, process.env, {
        workspaceRoot: this.workspaceRoot
      });

      this.substituteParams(this.toolchains, env);

      const rootPath = this.workspaceRoot + path.sep;
      const rootPathStrLen = rootPath.length;

      const targetNameList = this.getTargetNames(true);
      targetNameList.forEach(targetName => {
        const target = this.getTarget(targetName);
        if (typeof target !== 'object') return;

        let toolchainRoot = '';
        if (target.toolchain) {
          const toolchain = this.getToolchain(target.toolchain);
          if (toolchain && typeof toolchain.root === 'string') {
            toolchainRoot = toolchain.root;
          }
        }

        const productName = target.productName || 'out';

        let targetEnv = Object.assign({}, env, { toolchainRoot });
        targetEnv.sourceRoot = helper.substituteParams(target.sourceRoot || '', targetEnv);

        const configNameList = this.getConfigurationNamesForTarget(targetName, true);
        configNameList.forEach(configName => {
          const config = this.getConfigurationForTarget(targetName, configName);

          let productDir = config.productDir || '';
          if (productDir.indexOf(rootPath) === 0) {
            productDir = productDir.substr(rootPathStrLen);
          }

          const productFile = path.join(productDir, productName);

          if (config && typeof config.inherit === 'string') {
            const parentConfig = this.getConfigurationForTarget(targetName, config.inherit);
            if (parentConfig) {
              const newConfig: IBuildConfig.TargetConfiguration = helper.merge(parentConfig, config);
              delete newConfig['inherit'];
              target.configurations[configName] = newConfig;
              if (Array.isArray(newConfig.postBuildTasks)) {
                this.substituteParams(newConfig.postBuildTasks, { productFile });
              }
            }
          }
        });

        this.substituteParams(target, targetEnv);
      });

    }

    this.emit('changed');
  }

  substituteParams(input: any, values: Object, path: any[] = []): string | any[] | void {
    if (Array.isArray(input)) {
      path.push(input);
      for (let i = 0; i < input.length; i++) {
        const ret = this.substituteParams(input[i], values, path);
        if (Array.isArray(ret)) {
          input.splice(i, 1, ...ret);
        }
        else if (typeof ret === 'string') {
          if (ret === '') {
            input.splice(i, 1);
          }
          else {
            input[i] = ret;
          }
        }
      }
      path.pop();
    }
    else if (typeof input === 'object') {
      path.push(input);
      const keys = Object.keys(input);
      for (let i = 0, l = keys.length; i < l; i++) {
        const ret = this.substituteParams(input[keys[i]], values, path);
        if (ret) input[keys[i]] = ret;
      }
      path.pop();
    }
    else if (typeof input === 'string') {
      let retArr: any[] | undefined = undefined;
      let retStr = helper.substituteParams(input, values, (name, command) => {
        if (path.length > 1 && command === 'inherit') {
          // console.log(name);
          if (Array.isArray(path[path.length - 1]) && typeof path[path.length - 2] === 'object') {
            const inhItem = path[path.length - 2][name];
            if (Array.isArray(inhItem)) retArr = inhItem;
          }
        }
        return '';
      });
      return retArr || retStr;
    }
  }

}
