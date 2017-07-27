'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { CrossBuild } from './CrossBuild';

interface CBTaskDefinition extends vscode.TaskDefinition {
    command: string;
    target?: string;
}

let crossBuild: CrossBuild | undefined;

let taskProvider: vscode.Disposable | undefined;
let configFilePath = '';

export function activate(context: vscode.ExtensionContext) {
    if (!vscode.workspace.rootPath) return;
    crossBuild = new CrossBuild(context);
}

export function deactivate() {
    if (crossBuild) crossBuild.dispose();
}
