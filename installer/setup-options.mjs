import path from 'node:path';

/** Interactive AI app menu. Numbers keep their original meaning (Gemini was appended
 * as 5), so typed answers and existing instructions stay valid. Enter alone is Codex. */
export const CLIENT_CHOICES=[
  {number:'1',client:'codex',label:'Codex',note:'(default)'},
  {number:'2',client:'claude',label:'Claude Code'},
  {number:'3',client:'both',label:'Codex and Claude Code'},
  {number:'4',client:'none',label:'Manual',note:'only save config files; add them to your AI app'},
  {number:'5',client:'gemini',label:'Gemini (Antigravity)'},
];
export const CLIENT_LABELS={codex:'Codex',claude:'Claude Code',gemini:'Gemini (Antigravity)'};
export const CLIENT_PROMPT='Type a number and press Enter (Enter alone = 1): ';

export function clientMenu(home) {
  return ['','Which AI app will edit Premiere for you?',
    'Setup registers the Premiere MCP server and four Premiere editing skills',
    `for the app you choose, inside your user folder (${home}).`,'',
    ...CLIENT_CHOICES.map(choice=>`  ${choice.number}  ${choice.label}${choice.note?' '.repeat(Math.max(1,24-choice.label.length))+choice.note:''}`),''].join('\n');
}

export function clientFromChoice(answer) {
  const typed=String(answer??'').trim();
  return typed===''?'codex':CLIENT_CHOICES.find(choice=>choice.number===typed)?.client;
}

/** Resolved per-user targets of a registration plan, printed before anything is written. */
export function describeRegistration(plan,resultDirectory) {
  if(!plan.clients?.length)return `\nAI app registration: skipped (Manual). Config files to copy will be saved in ${resultDirectory}`;
  return ['\nAI app registration (this user):',...plan.clients.flatMap(target=>[
    `  ${(CLIENT_LABELS[target.client]??target.client).padEnd(22)}MCP entry  ${target.config}`,
    `  ${''.padEnd(22)}Skills     ${target.skillsTarget}`])].join('\n');
}

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
