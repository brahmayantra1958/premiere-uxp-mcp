type Row=Record<string,any>;
type Scope={pid:number;panelHandle:number;tab:string;headerIndex:number};
/** Locale comes from the exact native Speed stopwatch, never the OS or media
 * name. Unknown UI languages must not create an empty/mislocalized owner. */
export function speedGraphDisplayName(r:Row):'속도'|'Speed'{
  const row=r.rows?.[0],a=row?.animationControl;
  if(a?.role!==43||a.index!==row.index+1||!Number.isInteger(a.state)||!Number.isFinite(a.top)||!Number.isFinite(row.top)||Math.abs(a.top-row.top)>4)throw Error('SPEED_GRAPH_NATIVE_LABEL_UNVERIFIED');
  if(a.name==='애니메이션 켜기/끄기')return '속도';
  if(a.name==='Toggle animation')return 'Speed';
  throw Error('SPEED_GRAPH_NATIVE_LABEL_UNVERIFIED');
}
export function speedGraphLabelProves(r:Row,name:string):boolean{
  const row=r.rows?.[0];
  return Array.isArray(row?.graphLabels)&&row.graphLabels.length===1&&row.graphLabels[0].role===41&&typeof row.graphLabels[0].name==='string'&&row.graphLabels[0].name.startsWith(name+':');
}
/** A Boolean/property receipt cannot prove a view. Require a fresh, visible,
 * unique disclosure within the independently bound Time Remapping section. */
export function speedGraphScopeProves(r:Row,expected:Scope):boolean{
  const p=r.rows?.[0];
  return r.protocol===1&&r.status==='pass'&&r.route==='windows_msaa_parameter_state'
    &&r.premierePid===expected.pid&&r.panelHandle===expected.panelHandle
    &&r.selectedClipTab===expected.tab&&r.headerIndex===expected.headerIndex
    &&Array.isArray(r.rows)&&r.rows.length===1&&p.ordinal===0&&p.role===43
    &&p.name==='UI_DisclosureTriangleButton'&&Number.isInteger(p.state)&&(p.state&1)===0
    &&Number.isInteger(p.index)&&p.index>=0;
}
export function speedGraphObservationProves(r:Row,expected:Scope):boolean{
  if(!speedGraphScopeProves(r,expected))return false;
  const p=r.rows[0],v=r.viewport;
  return (p.state&(32768|65536))===0
    &&[p.top,p.width,p.height,v?.top,v?.height].every(Number.isFinite)
    &&p.width>0&&p.height>0&&v.height>=80&&p.top>=v.top+4&&p.top+42<=v.top+v.height;
}
