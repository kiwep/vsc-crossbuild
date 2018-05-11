import * as vscode from 'vscode';

export namespace IBuildConfig
{
  interface Toolchain {
    root?: string;
    tools?: {
      AS?: string;
      CC?: string;
      CXX?: string;
      LD?: string;
    }
  }

  interface ToolchainList {
    [index:string]: Toolchain;
  }

  interface TargetFlagList {
    [index:string]: string[];
  }

  interface TargetPostBuildTask {
    tool?: string;
    command?: string;
    args?: string[];
    outFile?: string;
  }

  interface TargetConfiguration {
    inherit?: string;
    productDir?: string;
    includePaths?: string[];
    ignoreSources?: string[];
    defines?: string[];
    flags?: TargetFlagList;
    extraLinkerFlags?: string[];
    postBuildTasks?: TargetPostBuildTask[];
  }

  interface TargetConfigurationList {
    [index:string]: TargetConfiguration;
  }

  interface TargetConfiguration {
  }

  interface Target {
    toolchain?: string;
    productName?: string;
    sourceRoot?: string;
    configurations?: TargetConfigurationList;
  }

  interface TargetList {
    [index:string]: Target;
  }

  interface BuildConfig {
    toolchains?: ToolchainList;
    targets?: TargetList;
  }

}

export interface IUserTaskDefinition extends vscode.TaskDefinition {
  command: string;
}

export interface ITargetPickItem extends vscode.QuickPickItem {
  target?: string;
  config?: string;
}
