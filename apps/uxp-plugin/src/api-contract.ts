import type {
  AudioClipTrackItem,
  AudioComponentChain,
  AudioTrack,
  ClipProjectItem,
  Component,
  ComponentParam,
  EncoderManager,
  FolderItem,
  Markers,
  ObjectMaskUtilsStatic,
  premierepro,
  Project,
  Sequence,
  SequenceEditor,
  SequenceUtilsStatic,
  TrackItemSelection,
  VideoClipTrackItem,
  VideoComponentChain,
  VideoTrack,
} from "@adobe/premierepro";

// This file emits no runtime code. Pick<> intentionally makes the build fail if
// Adobe removes or renames a public UXP member that the live host adapter uses.
export type PremiereModuleContract = Pick<premierepro,
  | "Project"
  | "SequenceEditor"
  | "SequenceUtils"
  | "Markers"
  | "ObjectMaskUtils"
  | "TransitionFactory"
  | "VideoFilterFactory"
  | "AudioFilterFactory"
  | "FolderItem"
  | "Keyframe"
  | "EncoderManager"
  | "Exporter"
  | "TickTime"
  | "AddTransitionOptions"
>;

export type ProjectContract = Pick<Project,
  | "getActiveSequence"
  | "openSequence"
  | "setActiveSequence"
  | "getSequences"
  | "getRootItem"
  | "createSequence"
  | "createSequenceWithPresetPath"
  | "importFiles"
  | "save"
  | "saveAs"
  | "executeTransaction"
  | "lockedAccess"
>;

export type SequenceContract = Pick<Sequence,
  | "getVideoTrackCount"
  | "getAudioTrackCount"
  | "getCaptionTrackCount"
  | "getVideoTrack"
  | "getAudioTrack"
  | "getSettings"
  | "getEndTime"
  | "createCloneAction"
  | "clearSelection"
  | "getSelection"
  | "setSelection"
>;

export type SequenceEditorContract = Pick<SequenceEditor,
  | "createRemoveItemsAction"
  | "createInsertProjectItemAction"
  | "createOverwriteItemAction"
  | "createCloneTrackItemAction"
  | "insertMogrtFromPath"
>;

export type SequenceUtilsContract = Pick<SequenceUtilsStatic,
  | "performSceneEditDetectionOnSelection"
  | "SEQUENCE_OPERATION_APPLYCUT"
>;

export type TrackItemSelectionContract = Pick<TrackItemSelection, "addItem" | "removeItem" | "getTrackItems">;

export type ProjectItemContract = Pick<ClipProjectItem,
  | "getMediaFilePath"
  | "isOffline"
  | "hasProxy"
  | "getProxyPath"
  | "attachProxy"
  | "isSequence"
  | "getSequence"
  | "createSetNameAction"
  | "getColorLabelIndex"
  | "createSetColorLabelAction"
>;

export type FolderItemContract = Pick<FolderItem,
  | "createBinAction"
  | "getItems"
  | "createMoveItemAction"
  | "createSetNameAction"
  | "getColorLabelIndex"
  | "createSetColorLabelAction"
>;

export type VideoTrackItemContract = Pick<VideoClipTrackItem,
  | "getStartTime"
  | "getEndTime"
  | "getInPoint"
  | "getOutPoint"
  | "createMoveAction"
  | "createSetStartAction"
  | "createSetEndAction"
  | "getComponentChain"
  | "createAddVideoTransitionAction"
  | "createRemoveVideoTransitionAction"
  | "createSetDisabledAction"
  | "createSetNameAction"
  | "getSpeed"
  | "isSpeedReversed"
>;

export type AudioTrackItemContract = Pick<AudioClipTrackItem,
  | "getStartTime"
  | "getEndTime"
  | "getInPoint"
  | "getOutPoint"
  | "createMoveAction"
  | "createSetStartAction"
  | "createSetEndAction"
  | "getComponentChain"
  | "createSetDisabledAction"
  | "createSetNameAction"
  | "getSpeed"
  | "isSpeedReversed"
>;

export type VideoTrackContract = Pick<VideoTrack, "createSetNameAction" | "setMute" | "isMuted" | "getTrackItems">;
export type AudioTrackContract = Pick<AudioTrack, "createSetNameAction" | "setMute" | "isMuted" | "getTrackItems">;

export type ComponentChainContract = Pick<VideoComponentChain,
  | "getComponentAtIndex"
  | "getComponentCount"
  | "createAppendComponentAction"
  | "createInsertComponentAction"
  | "createRemoveComponentAction"
>;
export type AudioComponentChainContract = Pick<AudioComponentChain,
  | "getComponentAtIndex"
  | "getComponentCount"
  | "createAppendComponentAction"
  | "createInsertComponentAction"
  | "createRemoveComponentAction"
>;

export type ComponentContract = Pick<Component, "getParam" | "getParamCount" | "getDisplayName" | "getMatchName">;
export type ComponentParamContract = Pick<ComponentParam,
  | "displayName"
  | "getValueAtTime"
  | "areKeyframesSupported"
  | "getKeyframeListAsTickTimes"
  | "createKeyframe"
  | "createSetTimeVaryingAction"
  | "createSetValueAction"
  | "createAddKeyframeAction"
  | "createRemoveKeyframeAction"
>;
export type MarkersContract = Pick<Markers, "getMarkers" | "createAddMarkerAction">;
export type ObjectMaskUtilsContract = Pick<ObjectMaskUtilsStatic, "hasObjectMask">;
export type EncoderContract = Pick<EncoderManager, "exportSequence">;
