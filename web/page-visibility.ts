import {useSyncExternalStore} from 'react';

const subscribe=(change:()=>void)=>{document.addEventListener('visibilitychange',change);return()=>document.removeEventListener('visibilitychange',change);};
const hidden=()=>document.visibilityState==='hidden';

/** True while the document is hidden (background tab, minimised window, locked phone). */
export function usePageHidden():boolean{return useSyncExternalStore(subscribe,hidden,()=>false);}
