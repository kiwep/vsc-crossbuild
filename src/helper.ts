import * as fs from 'fs';
import { spawn, SpawnOptions } from 'child_process';
import { createHash, Hash } from 'crypto';

const paramRegexp = /\$\{([a-z\.-_\:]+)\}/gi
let md5hasher: Hash | undefined = undefined;

export function readFileContent(filePath: string, encoding = 'utf8'): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, encoding, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

export function writeFileContent(filePath: string, content: string, encoding = 'utf8'): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.writeFile(filePath, content, {encoding}, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function mergeArrays(dest: any[], src: any[]): any[] {
  for (let i = 0, l = src.length; i < l; i++) {
    if (Array.isArray(src[i])) {
      dest.push(mergeArrays([], src[i]));
    }
    else if (typeof src[i] === 'object') {
      dest.push(mergeObjects({}, src[i]));
    }
    else {
      dest.push(src[i]);
    }
  }

  return dest;
}

function mergeObjects(dest: Object, src: Object): Object {
  const keyList = Object.keys(src);
  for (let i = 0, l = keyList.length; i < l; i++) {
    const key = keyList[i];
    if (Array.isArray(src[key])) {
      if (!dest.hasOwnProperty(key) || !Array.isArray(dest[key])) {
        dest[key] = [];
      }
      mergeArrays(dest[key], src[key]);
    }
    else if (typeof src[key] === 'object') {
      if (!dest.hasOwnProperty(key) || typeof dest[key] !== 'object') {
        dest[key] = {};
      }
      mergeObjects(dest[key], src[key]);
    }
    else {
      dest[key] = src[key];
    }
  }

  return dest;
}

export function merge(...objs: Object[]): Object {
  const res = {};
  for (let i = 0, l = objs.length; i < l; i++) {
    const o = objs[i];
    mergeObjects(res, o);
  }
  return res;
}

type MatchCallback = (name: string, command: string | undefined) => string;

export function substituteParams(input: string, values: Object, contextCallback?: MatchCallback): string {
  return input.replace(paramRegexp, (m, r0: string) => {
    if (r0.includes(':') && contextCallback) {
      let [command, name] = r0.split(':', 2);
      return contextCallback(name, command);
    }
    return values[r0];
  });
}

export function md5(str: string): string {
  if (!md5hasher) md5hasher = createHash('md5');
  return md5hasher.update(str).digest('hex');
}

export function execCommand(command: string, args: string[], options?: SpawnOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.on('error', reject);
    child.on('close', resolve);
  });
}
