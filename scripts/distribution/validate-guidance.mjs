import {fileURLToPath, URL} from 'node:url';
import console from 'node:console';
import {validateGuidance} from './guidance-lib.mjs';
console.log(JSON.stringify(validateGuidance(fileURLToPath(new URL('../../',import.meta.url)))));
