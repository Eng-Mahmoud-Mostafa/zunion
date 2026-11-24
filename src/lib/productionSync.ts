type Change = { completedOrderId?: string };
const eventName = "zunion-production-changed";
const storageKey = "zunion-production-change";
export function publishProductionChange(completedOrderId?: string) {
 const change: Change = {completedOrderId};
 window.dispatchEvent(new CustomEvent(eventName,{detail:change}));
 if (typeof BroadcastChannel !== "undefined") {
  const channel = new BroadcastChannel(eventName); channel.postMessage(change); channel.close();
 } else { try {localStorage.setItem(storageKey,JSON.stringify({...change,nonce:Date.now()}));} catch { /* Polling remains available. */ } }
}
export function subscribeProductionChanges(callback:(change:Change)=>void) {
 const local = (event:Event)=>callback((event as CustomEvent<Change>).detail||{});
 const focus = ()=>callback({});
 const visibility = ()=>{if(document.visibilityState==="visible")callback({});};
 const storage = (event:StorageEvent)=>{if(event.key===storageKey){try{callback(JSON.parse(event.newValue||"{}"));}catch{callback({});}}};
 const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(eventName) : null;
 if(channel)channel.onmessage=event=>callback(event.data||{});
 window.addEventListener(eventName,local);window.addEventListener("focus",focus);window.addEventListener("storage",storage);document.addEventListener("visibilitychange",visibility);
 return ()=>{channel?.close();window.removeEventListener(eventName,local);window.removeEventListener("focus",focus);window.removeEventListener("storage",storage);document.removeEventListener("visibilitychange",visibility);};
}
