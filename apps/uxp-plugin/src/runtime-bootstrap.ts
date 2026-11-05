/** Adobe owns launch consent. At most one request per plugin Load, so a denied
 * or failed launch never becomes a repeated dialog. No caller supplies a path. */
export class RuntimeBootstrap {
  private attempted = false;
  constructor(private readonly shell: {openPath(path:string,reason:string):Promise<string>} | undefined,
    private readonly launcherPath:string | undefined,private readonly log:(message:string)=>void) {}

  async start():Promise<void>{
    if(this.attempted)return;
    this.attempted=true;
    if(!this.shell||!this.launcherPath){this.log('Automatic runtime launcher is unavailable in this build.');return;}
    try {
      const error=await this.shell.openPath(this.launcherPath,
        'Premiere MCP 연결을 위해 이 플러그인의 로컬 서버를 시작합니다. 기존 Node를 사용하며 프로젝트 내용은 변경하지 않습니다.');
      if(error)this.log(`Runtime startup was not accepted: ${error}`);
      else this.log('Runtime startup requested; waiting for authenticated connection.');
    }catch(error){this.log(`Runtime startup unavailable: ${String(error)}`);}
  }
}
