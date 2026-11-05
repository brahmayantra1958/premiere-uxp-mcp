import path from 'node:path';

/** Parse before downloads/builds. Preparation never touches client or Adobe state. */
export function setupOptions(args,{interactive=false}={}) {
  const options={prepareOnly:false,skipDependencies:false,nonInteractive:!interactive,noConnect:false,connect:false,replaceClient:false,replaceSkills:false};
  const values={'--client':'client','--client-config':'config','--skills-target':'skillsTarget','--native-addons':'nativeAddons'};
  const flags={'--prepare-only':'prepareOnly','--skip-dependencies':'skipDependencies','--non-interactive':'nonInteractive','--no-connect':'noConnect','--connect':'connect','--replace-client':'replaceClient','--replace-skills':'replaceSkills','--help':'help'};
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(values[arg]) {if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing value: '+arg);options[values[arg]]=args[++i];}
    else if(flags[arg])options[flags[arg]]=true;
    else throw Error('Unknown argument: '+arg);
  }
  if(options.client&&!['codex','claude','gemini','both','none'].includes(options.client))throw Error('--client must be codex, claude, gemini, both or none');
  for(const key of ['config','skillsTarget','nativeAddons'])if(options[key]&&!path.isAbsolute(options[key]))throw Error(key+' must be an absolute path');
  if(options.prepareOnly&&(options.client&&options.client!=='none'||options.config||options.skillsTarget||options.replaceClient||options.replaceSkills||options.nativeAddons||options.connect))throw Error('--prepare-only cannot register clients, install add-ons or connect');
  if(options.connect&&options.noConnect)throw Error('--connect and --no-connect cannot be combined');
  if((options.config||options.skillsTarget)&&!['codex','claude','gemini'].includes(options.client))throw Error('Custom configuration/skills paths require a single --client');
  if(!options.help&&!options.prepareOnly&&options.nonInteractive&&!options.client)throw Error('Non-interactive installation requires --client codex|claude|gemini|both|none');
  return options;
}
