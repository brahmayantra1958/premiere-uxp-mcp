export type MaskTrackingTarget={sequenceId:string;trackIndex:number;startTicks:string;endTicks:string;projectItemId:string;clipName:string};
export type NativeMaskWork={target:MaskTrackingTarget;sequenceName:string};
export type MaskTrackingPhase="before"|"step"|"after";
export type MaskTrackingWork={target:MaskTrackingTarget;sequenceName:string;maskName:string;direction:"forward"|"backward";frames:number};
