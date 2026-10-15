"use client";
import { useRef, useState } from "react";
import type { Meeting } from "../domain/models";
import { useEngagementState } from "../infrastructure/state";
import { usePermissions } from "@/modules/workspace/presentation/usePermissions";
import { executeOperation, meetingOperationBaseline, operationAttempt, usesRemoteOperations } from "@/shared/infrastructure/operations";
const fields=["summary","notes","decisions","actions","prep","learnings","implications","receptiveness","commitmentObtained","tags"] as const;
/** A single confirmed intent keeps toggles and append actions stable across polling/retries. */
export function useMeetingContent(meeting:Meeting|undefined){
  const {updateMeeting:saveLocal,setNotes}=useEngagementState();const {can}=usePermissions();
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [pending,setPending]=useState(false);
  const locked=useRef(false);const request=useRef<null|(()=>Promise<void>)>(null);
  const draftBaseline=useRef<Record<string,string>|null>(null);
  function begin(){draftBaseline.current??=meetingOperationBaseline();}
  function reset(){if(locked.current)return;request.current=null;draftBaseline.current=null;setPending(false);setError("");}
  async function run(){if(locked.current||!request.current)return;locked.current=true;setBusy(true);setError("");try{await request.current();request.current=null;draftBaseline.current=null;setPending(false);}catch(e){setError(e instanceof Error?e.message:"Não foi possível confirmar a alteração.");}finally{locked.current=false;setBusy(false);}}
  async function update(next:Meeting,message?:string|null,confirmed?:()=>void,explicit?:Pick<Meeting,"notes">){
    if(locked.current||request.current||!meeting||!can("reunioes.agendar",meeting.company))return;
    const patch=Object.fromEntries(fields.filter(key=>JSON.stringify(next[key])!==JSON.stringify(meeting[key])).map(key=>[key,next[key]??null]));
    const input={meetingId:meeting.id,patch:{...patch,...explicit}};const baseline=draftBaseline.current??meetingOperationBaseline();
    const attempt=operationAttempt("meetings.content.update",input);
    request.current=async()=>{if(await usesRemoteOperations()){await executeOperation("meetings.content.update",input,attempt,baseline);}else{saveLocal(next,message);if("notes"in patch)setNotes(next.id,next.notes??"");}confirmed?.();};
    setPending(true);await run();
  }
  return {update,begin,reset,retry:run,busy,error,pending};
}
