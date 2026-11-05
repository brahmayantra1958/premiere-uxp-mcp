/** An immutable, already-read XML document. Caches belong to these exact bytes,
 * never to a path, mtime, project or process. A save/patch must create a new
 * document. No I/O or live host evidence is cached here. */
export class NativeArchiveDocument {
  readonly #values = new Map<symbol, unknown>();
  readonly #objects = new Map<string, readonly string[]>();
  #openings: Map<string, number | number[]> | undefined;
  constructor(readonly xml: string) { Object.freeze(this); }

  memo<T>(key: symbol, build: () => T): T {
    if (!this.#values.has(key)) this.#values.set(key, build());
    return this.#values.get(key) as T;
  }

  /** Preserve the existing reference-specific parser and duplicate semantics,
   * including nested native view-state scopes; never globally collapse IDs. */
  objects(id: string, uid = false): readonly string[] {
    const key = `${uid ? 'uid' : 'id'}:${id}`;
    if (!this.#objects.has(key)) {
      this.#openings ??= this.indexOpenings();
      const matches:string[]=[];
      const positions=this.#openings.get(key),tagReader=/<([A-Za-z0-9_]+)\b/y;
      let consumed=0;
      for(const start of typeof positions==='number'?[positions]:positions??[]){
        if(start<consumed)continue;
        tagReader.lastIndex=start;
        const tag=tagReader.exec(this.xml)![1],body=this.xml.indexOf('>',start)+1;
        const closing=`</${tag}>`,end=this.xml.indexOf(closing,body);
        if(end<0)continue;
        consumed=end+closing.length;
        matches.push(this.xml.slice(start,consumed));
      }
      this.#objects.set(key, Object.freeze(matches));
    }
    return this.#objects.get(key)!;
  }

  /** Index openings, not whole elements: nested view-state IDs must remain
   * visible. Closing at the first same-name tag and skipping overlapping
   * matches per requested ID preserve the previous per-reference regex exactly.
   * Store offsets only; allocate a list only for duplicated IDs, not every node. */
  private indexOpenings(){
    const index=new Map<string,number|number[]>();
    for(const match of this.xml.matchAll(/<[A-Za-z0-9_]+\b[^>]*Object(?:UID|ID)="[^"]*"[^>]*>/g)){
      for(const attribute of match[0].matchAll(/Object(UID|ID)="([^"]*)"/g)){
        const key=`${attribute[1]==='UID'?'uid':'id'}:${attribute[2]}`;
        const prior=index.get(key);
        if(prior===undefined)index.set(key,match.index);
        else if(typeof prior==='number'){if(prior!==match.index)index.set(key,[prior,match.index]);}
        else if(prior.at(-1)!==match.index)prior.push(match.index);
      }
    }
    return index;
  }
}

export type NativeArchiveSource = string | NativeArchiveDocument;
export const archiveDocument = (source: NativeArchiveSource): NativeArchiveDocument =>
  typeof source === 'string' ? new NativeArchiveDocument(source) : source;
