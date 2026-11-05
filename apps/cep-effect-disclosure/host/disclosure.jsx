/* ES3. Only native Effect Controls disclosure preferences, scoped to each active local project request. */
var BrahmaYantraEffectDisclosure = (function () {
    function normalized(value) { return String(value).replace(/\//g, "\\").replace(/^\\\\\?\\/, "").toLowerCase(); }
    function guid(value) { return String(value).replace(/[{}]/g, "").toLowerCase(); }
    function json(value) {
        if (value === null || typeof value === "undefined") return "null";
        if (typeof value === "string") return '"' + value.replace(/["\\\x00-\x1f\u2028\u2029]/g, function (c) { var h=c.charCodeAt(0).toString(16); return "\\u"+("0000"+h).slice(-4); }) + '"';
        if (typeof value === "boolean" || typeof value === "number") return String(value);
        var parts=[],i,key;if(value instanceof Array){for(i=0;i<value.length;i++)parts.push(json(value[i]));return "["+parts.join(",")+"]";}
        for(key in value)if(value.hasOwnProperty(key))parts.push(json(key)+":"+json(value[key]));return "{"+parts.join(",")+"}";
    }
    function context(r) {
        if(!r || r.version!==1 || (r.operation!=="read_effect_disclosure" && r.operation!=="set_effect_disclosure"))throw Error("INVALID_OPERATION");
        if(new Date().getTime()>r.expiresAt)throw Error("EXPIRED_REQUEST");
        if(!/^[a-z]:\\.*\.prproj$/.test(normalized(r.projectPath)))throw Error("LOCAL_PROJECT_REQUIRED");
        var p=app.project,s=p&&p.activeSequence;
        if(!p||normalized(p.path)!==normalized(r.projectPath))throw Error("PROJECT_CHANGED");
        if(!s||guid(s.sequenceID)!==guid(r.sequenceId)||s.name!==r.sequenceName)throw Error("SEQUENCE_CHANGED");
        return s;
    }
    function componentKey(s,t) {
        if(!t || (t.mediaType!=="video"&&t.mediaType!=="audio") || !/^[0-9]+$/.test(String(t.trackIndex)) || !/^[0-9]+$/.test(t.startTicks) || !/^[0-9]+$/.test(t.endTicks))throw Error("INVALID_CLIP_TARGET");
        if(typeof t.componentMatchName!=="string" || t.componentMatchName.length>200 || /[\x00-\x1f]/.test(t.componentMatchName))throw Error("INVALID_COMPONENT");
        var tracks=t.mediaType==="video"?s.videoTracks:s.audioTracks;
        if(t.trackIndex>=tracks.numTracks)throw Error("TRACK_CHANGED");
        var clips=tracks[t.trackIndex].clips,matches=[],i,c;
        if(clips.numItems>1000)throw Error("TRACK_UNBOUNDED");
        for(i=0;i<clips.numItems;i++){
            c=clips[i];if(String(c.start.ticks)===t.startTicks&&String(c.end.ticks)===t.endTicks&&c.name===t.clipName&&c.projectItem&&normalized(c.projectItem.getMediaPath())===normalized(t.mediaPath))matches.push(c);
        }
        if(matches.length!==1)throw Error("CLIP_NOT_UNIQUE_OR_CHANGED");
        var chain=matches[0].components,count=0,motion=0,opacity=0;
        if(chain.numItems>64)throw Error("EFFECT_CHAIN_UNBOUNDED");
        for(i=0;i<chain.numItems;i++){
            if(chain[i].matchName===t.componentMatchName)count++;
            if(chain[i].matchName==="AE.ADBE Motion")motion++;
            if(chain[i].matchName==="AE.ADBE Opacity")opacity++;
        }
        // Native Time Remapping is not a member of the public component chain.
        // Its exact preference was observed in a user sample and independently
        // verified false→true→false. Only this intrinsic video layout is allowed;
        // this does not expose the Speed value, graph, or arbitrary preferences.
        if(t.componentMatchName==="BE.TimeRemapping"){
            if(t.mediaType!=="video"||t.componentIndex!==undefined||count!==0||motion!==1||opacity!==1)throw Error("TIME_REMAPPING_LAYOUT_UNVERIFIED");
            return "ECP.Filter.ExpandedBE.TimeRemapping";
        }
        // Slot guards identify a duplicate instance, but the native preference
        // intentionally affects its whole match-name group. Native transition
        // proof outside CEP must identify exactly count affected headers.
        if(t.componentIndex!==undefined){
            if(t.componentIndex<0||t.componentIndex>=chain.numItems||Math.floor(t.componentIndex)!==t.componentIndex||chain[t.componentIndex].matchName!==t.componentMatchName)throw Error("COMPONENT_INDEX_CHANGED");
        }else if(count!==1)throw Error("COMPONENT_NOT_UNIQUE_OR_CHANGED");
        if(count<1)throw Error("COMPONENT_CHANGED");
        return "ECP.Filter.Expanded"+t.componentMatchName;
    }
    return { execute:function(r){var dispatched=false;
        try {
            var s=context(r),key=componentKey(s,r.target),before=app.properties.getProperty(key);
            if(before!==""&&before!=="true"&&before!=="false")throw Error("DISCLOSURE_VALUE_UNSUPPORTED");
            if(r.operation==="read_effect_disclosure")return json({status:"pass",route:"cep_effect_disclosure",value:before,componentMatchName:r.target.componentMatchName});
            if(typeof r.expanded!=="boolean")throw Error("EXPANDED_BOOLEAN_REQUIRED");
            // UXP owns selection and its event-cycle boundary. Never change unrelated clip selection here.
            if(s.getSelection().length!==0)throw Error("EFFECT_PANEL_NOT_CLEARED");
            if(app.properties.isPropertyReadOnly(key))throw Error("DISCLOSURE_READ_ONLY");
            dispatched=true;app.properties.setProperty(key,r.expanded,0,1);
            s=context(r);if(componentKey(s,r.target)!==key)throw Error("COMPONENT_CHANGED");
            var after=app.properties.getProperty(key);
            if(after!==String(r.expanded))throw Error("DISCLOSURE_PREFERENCE_READBACK_MISMATCH");
            // This proves only the preference. Independent native UI readback is still required.
            return json({status:"pass",route:"cep_effect_disclosure",before:before,after:after,componentMatchName:r.target.componentMatchName,scope:"effect_match_name",uiVerified:false});
        } catch(error) { return json({status:dispatched?"unverified":"fail",error:String(error)}); }
    }};
}());
