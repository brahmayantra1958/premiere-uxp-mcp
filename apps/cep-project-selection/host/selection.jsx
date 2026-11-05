/* ES3; staged only until the project-selection exception is approved. */
var BrahmaYantraProjectSelection = (function () {
    function normalized(value) { return String(value).replace(/\//g, "\\").replace(/^\\\\\?\\/, "").toLowerCase(); }
    function guid(value) { return String(value).replace(/[{}]/g, "").toLowerCase(); }
    function json(value) {
        if (value === null) return "null";
        if (typeof value === "string") return '"' + value.replace(/["\\\x00-\x1f\u2028\u2029]/g, function (c) {var h=c.charCodeAt(0).toString(16);return "\\u"+("0000"+h).slice(-4);}) + '"';
        if (typeof value === "boolean" || typeof value === "number") return String(value);
        var parts=[],i,key;if(value instanceof Array){for(i=0;i<value.length;i++)parts.push(json(value[i]));return "["+parts.join(",")+"]";}
        for(key in value)if(value.hasOwnProperty(key))parts.push(json(key)+":"+json(value[key]));return "{"+parts.join(",")+"}";
    }
    function context(r) {
        if(!r || r.version!==1 || (r.operation!=="read_project_selection" && r.operation!=="set_project_selection"))throw Error("INVALID_OPERATION");
        if(new Date().getTime()>r.expiresAt)throw Error("EXPIRED_REQUEST");
        if(!/^[a-z]:\\.*\.prproj$/.test(normalized(r.projectPath)))throw Error("LOCAL_PROJECT_REQUIRED");
        var p=app.project,s=p&&p.activeSequence;if(!p||normalized(p.path)!==normalized(r.projectPath))throw Error("PROJECT_CHANGED");
        if(!s||guid(s.sequenceID)!==guid(r.sequenceId)||s.name!==r.sequenceName)throw Error("SEQUENCE_CHANGED");
        var ids=app.getProjectViewIDs(),views=[],i,owner;
        for(i=0;ids&&i<ids.length;i++){owner=app.getProjectFromViewID(ids[i]);if(owner&&normalized(owner.path)===normalized(r.projectPath))views.push(ids[i]);}
        if(views.length!==1)throw Error("PROJECT_VIEW_NOT_UNIQUE");return {project:p,view:views[0]};
    }
    function ids(items){var result=[],i;for(i=0;items&&i<items.length;i++)result.push(String(items[i].nodeId));return result.sort();}
    function target(project,r){
        var item=project.rootItem,children,i,j,matches;
        for(i=0;i<r.target.pathSegments.length;i++){children=item.children;matches=[];if(!children||children.numItems>500)throw Error("BIN_UNAVAILABLE_OR_UNBOUNDED");
            for(j=0;j<children.numItems;j++)if(children[j].name===r.target.pathSegments[i])matches.push(children[j]);
            if(matches.length!==1)throw Error("PROJECT_ITEM_PATH_NOT_UNIQUE");item=matches[0];}
        var kind=item.type===2?"folder":item.isSequence()?"sequence":"clip";
        if(kind!==r.target.kind)throw Error("PROJECT_ITEM_KIND_CHANGED");
        if(kind==="clip"&&normalized(item.getMediaPath())!==normalized(r.target.mediaPath))throw Error("PROJECT_ITEM_MEDIA_CHANGED");
        if(kind==="sequence"){matches=[];for(i=0;i<project.sequences.numSequences;i++)if(project.sequences[i].projectItem.nodeId===item.nodeId)matches.push(project.sequences[i]);if(matches.length!==1||guid(matches[0].sequenceID)!==guid(r.target.sequenceId))throw Error("PROJECT_ITEM_SEQUENCE_CHANGED");}
        return item;
    }
    return { execute:function(r){var before=null,c,changed=false,after,restored=false;
        try{c=context(r);before=app.getProjectViewSelection(c.view)||[];
            if(r.operation==="read_project_selection")return json({status:"pass",route:"cep_project_selection",ids:ids(before)});
            var item=target(c.project,r);if(typeof app.setProjectViewSelection!=="function")throw Error("PROJECT_SELECTION_API_UNAVAILABLE");changed=true;app.setProjectViewSelection([item],c.view);
            c=context(r);after=app.getProjectViewSelection(c.view)||[];
            if(json(ids(after))!==json(ids([item])))throw Error("PROJECT_SELECTION_READBACK_MISMATCH");
            return json({status:"pass",route:"cep_project_selection",beforeIds:ids(before),afterIds:ids(after),pathSegments:r.target.pathSegments,selectionBroadcast:true});
        }catch(error){restored=!changed;if(changed&&before)try{c=context(r);app.setProjectViewSelection(before,c.view);restored=json(ids(app.getProjectViewSelection(c.view)||[]))===json(ids(before));}catch(ignored){}
            return json({status:restored?"fail":"unverified",restored:restored,error:String(error)});}
    }};
}());
