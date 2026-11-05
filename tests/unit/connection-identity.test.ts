import {expect,it} from 'vitest';
import {resolveSavedConnection} from '../../apps/uxp-plugin/src/project-credential.js';
it('reuses authenticated transport credentials after a project switch',async()=>{
 const store={get:async(id:string)=>id==='old-project'?'saved-secret':undefined};
 expect(await resolveSavedConnection(store,'old-project','new-project')).toEqual({projectId:'old-project',credential:'saved-secret'});
 expect(await resolveSavedConnection(store,'old-project','')).toEqual({projectId:'old-project',credential:'saved-secret'});
});
it('migrates an existing current-project credential without inventing authentication',async()=>{
 const store={get:async(id:string)=>id==='current'?'existing-secret':undefined};
 expect(await resolveSavedConnection(store,'','current')).toEqual({projectId:'current',credential:'existing-secret'});
 expect(await resolveSavedConnection(store,'expired','unknown')).toBeUndefined();
});
