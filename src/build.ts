import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';
import * as os from 'os';
import * as glob from 'glob';
import * as rimraf from 'rimraf';
import * as helper from './helper';
import { spawn } from 'child_process';

import { BuildConfig } from './BuildConfig';
import { IBuildConfig, IUserTaskDefinition, ITargetPickItem } from './interface';

import * as program from 'commander';

program
  .version(require('../../package').version)
  .option('-t, --target <target>', 'Target name (required)')
  .option('-c, --config <configuration>', 'Configuration name (required)')
  .option('-tcf, --tcfpath [path]', 'Target-configuration file path (provides target and config)')
  .option('-f, --file [path]', 'Configuration file path', path.join('.vscode', 'crossbuild.json'))
  .option('-n, --ninja [path]', 'The ninja executable path (it not on the shells PATH)', 'ninja')
  .option('--clean', 'Clean instead of build')
  .parse(process.argv);

if (!program.tcfpath && (!program.target || !program.config)) {
  program.outputHelp();
  process.exit();
}

const extMap = {
  '.c': 'CC',
  '.cpp': 'CXX',
  '.cc': 'CXX',
  '.s': 'AS'
};

const toolBins = {};

const NINLN = ' $\n  ';

const ninjaEscapeRegexp = /([ \$])/g;
function ninjaEscape(str: string): string {
  return str.replace(ninjaEscapeRegexp, function(m, m0) { return '$' + m0; });
}

function closeFlushStream(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once('open', fd => {
      stream.once('close', _ => {
        fs.fsync(fd, _ => {
          resolve();
        });
      });
      stream.end();
    });
  });
}

async function run() {
  if (!fs.existsSync(program.file)) {
    console.error(`Error: Configuration file "${program.file}" not found!`);
    process.exit(1);
  }
  const config = new BuildConfig(process.cwd(), undefined, true);
  config.configFilePath = program.file;
  await config.reloadConfigFile();

  if (program.tcfpath) {
    try {
      const tfc = JSON.parse(await helper.readFileContent(program.tcfpath));
      program.target = tfc['target'];
      program.config = tfc['config'];
    }
    catch (e) {}
  }

  const target = config.getTarget(program.target);
  if (!target) {
    console.error(`Error: Target "${program.target}" not found!`);
    process.exit(1);
  }

  const targetConfig = config.getConfigurationForTarget(program.target, program.config);
  if (!targetConfig) {
    console.error(`Error: Configuration "${program.config}" for target "${program.target}" not found!`);
    process.exit(1);
  }

  const sourceRoot = target.sourceRoot || '';
  const sourceGlob = path.join(sourceRoot, '**', '*.{c,cpp,cc,s}');
  const rootPath = process.cwd() + path.sep;
  const ignoreGlobs = (targetConfig.ignoreSources || []).map(item => path.join(sourceRoot, item));
  const rootPathStrLen = rootPath.length;

  let productDir = path.resolve(targetConfig.productDir || '');
  if (productDir.indexOf(rootPath) === 0) {
    productDir = productDir.substr(rootPathStrLen);
  }

  const toolchain = config.getToolchain(target.toolchain || '');
  if (!toolchain) {
    console.error(`Error: Toolchain "${target.toolchain}" for target "${program.target}" not found!`);
    process.exit(1);
  }

  if (typeof toolchain.tools !== 'object') {
    console.error(`Error: Toolchain configuration "${target.toolchain}" is missing the tools definition!`);
    process.exit(1);
  }

  if (program.clean) {
    console.log(`Cleaning ${productDir}...`);
    rimraf.sync(productDir);
    rimraf.sync('.ninja_*');
    return;
  }

  const outFilePath = path.join(os.tmpdir(), helper.md5(process.cwd()) + '.ninja');
  const outStream = fs.createWriteStream(outFilePath, { encoding: 'utf8' });

  outStream.write('ninja_required_version = 1.3\n\n');
  outStream.write('#\n# toolchain\n#\n');

  const defines = (targetConfig.defines || []).map(item => '-D' + item).join(NINLN);
  const includes = (targetConfig.includePaths || []).map(item => '-I' + item).join(NINLN);

  Object.keys(toolchain.tools).forEach(toolName => {
    let toolPath = toolchain.tools[toolName];
    if (typeof toolPath === 'string') {
      if (!path.isAbsolute(toolPath)) toolPath = path.join(toolchain.root, toolPath);
      toolBins[toolName] = toolPath;
      const isC = toolName === 'CC' || toolName == 'CXX';
      const isAS = toolName === 'AS';
      const isLD = toolName === 'LD';
      const flagsName = toolName.toLowerCase() + '_flags';
      const targetFlags: string[] = typeof targetConfig.flags === 'object' && Array.isArray(targetConfig.flags[toolName]) ? targetConfig.flags[toolName] : [];
      const flagsArr = [targetFlags.join(NINLN)];
      if (!isAS) flagsArr.push(defines);
      if (isC) flagsArr.push(includes);
      const flags = flagsArr.join(NINLN);
      let mapParams = '';
      let extraParams = '';
      outStream.write(`${flagsName} = ${flags}\n\n`);
      if (isLD && Array.isArray(targetConfig.extraLinkerFlags) && targetConfig.extraLinkerFlags.length > 0) {
        const extraFlags = targetConfig.extraLinkerFlags.join(NINLN);
        outStream.write(`ld_extra_flags = ${extraFlags}\n\n`);
        extraParams = ' $ld_extra_flags'
      }
      outStream.write(`rule ${toolName}\n`);
      if (isC) {
        mapParams = ' -MMD -MF $out.d -c';
        outStream.write(`  depfile = $out.d\n`);
        outStream.write('  deps = gcc\n');
      }
      outStream.write(`  command = ${toolPath} $${flagsName}${mapParams} $in${extraParams} -o $out\n\n`);
    }
  });

  const productName = target.productName || 'out';
  const productFile = path.join(productDir, productName);

  const build: string[] = [];
  const obj: string[] = [];

  glob.sync(sourceGlob, { ignore: ignoreGlobs, follow: true }).forEach((srcpath: string) => {
    if (srcpath.indexOf(rootPath) === 0) {
      srcpath = srcpath.substr(rootPathStrLen);
    }
    srcpath = ninjaEscape(srcpath);
    const ext = extMap[path.extname(srcpath).toLowerCase()];
    const objpath = ninjaEscape(path.join(productDir, 'obj', srcpath) + '.o');
    obj.push(objpath);
    build.push(`build ${objpath}: ${ext} ${srcpath}`);
  });

  outStream.write('\n#\n# sources -> objects\n#\n');
  outStream.write(build.join('\n'));
  outStream.write('\n');

  outStream.write('\n#\n# target bin\n#\n');
  outStream.write(`build ${productFile}: LD ` + obj.join(NINLN));
  outStream.write('\n');

  outStream.write('\n#\n# named target\n#\n');
  outStream.write(`build ${productName}: phony ${productFile}\n`);
  outStream.write(`default ${productName}\n`);

  // outStream.end();
  await closeFlushStream(outStream); //, outFs);

  console.log('Working directory:', process.cwd());
  console.log(`Build file: ${outFilePath}`);
  const code = await helper.execCommand(program.ninja, ['-f', outFilePath], { stdio: 'inherit' });
  if (code !== 0) {
    process.exit(code);
  }

  console.log('*** Build succeded ***');

  if (Array.isArray(targetConfig.postBuildTasks)) {
    for (let i = 0; i < targetConfig.postBuildTasks.length; i++) {
      const task: IBuildConfig.TargetPostBuildTask = targetConfig.postBuildTasks[i];
      let cmd: string | undefined = undefined;
      if (task.tool && toolBins[task.tool]) {
        cmd = toolBins[task.tool];
      }
      else cmd = task.command;

      if (cmd) {
        let stdio: string | any[] = 'inherit';
        let fd = -1;
        if (typeof task.outFile === 'string') {
          fd = fs.openSync(task.outFile, 'w');
          stdio = [ process.stdin, fd, fd ];
        }
        await helper.execCommand(cmd, task.args ||  [], { stdio });
        if (fd > -1) {
          fs.closeSync(fd);
        }
      }
    }
  }
}

run();
