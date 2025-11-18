const HISTORY_MANAGEMENT_NAMESPACE='historyManagement';let isHistoryRestoringState=false;let isLoggedOut=false;function initializeLogoutState(){const logoutState=localStorage.getItem('isLoggedOut');if(logoutState==='true'){isLoggedOut=true;}}
function saveLogoutState(){localStorage.setItem('isLoggedOut','true');}
function clearLogoutState(){localStorage.removeItem('isLoggedOut');isLoggedOut=false;}
function performHistoryInitialization(){if(typeof cleanupModalSelect2==='function'){cleanupModalSelect2();}
$(document).off('.tableEvents .tableMaster .tableSearch .pagination .editForm .deleteConfirm .modalEvents');if(typeof clearInitializationFlags==='function'){clearInitializationFlags();}
if(typeof performInitialization==='function'){performInitialization();}}
function setupLogoutHistory(){try{isLoggedOut=true;saveLogoutState();sessionStorage.clear();history.replaceState({logout:true},'',window.location.href);for(let i=0;i<5;i++){history.pushState({logout:true},'',window.location.href);}}catch(error){console.warn('ログアウト履歴設定に失敗:',error);}}
function saveCompleteState(){if(!isHistoryRestoringState&&!isLoggedOut){const state={content:document.getElementById('main-content')?.innerHTML||'',sidebarState:document.querySelector('.sidebar')?.classList.contains('active')||false,url:window.location.pathname,timestamp:Date.now()};try{history.replaceState(state,'',window.location.href);}catch(error){console.warn('履歴状態の保存に失敗:',error);}}}
function restoreCompleteState(state){if(!state||!state.content){console.warn('復元する状態が無効です');return;}
isHistoryRestoringState=true;try{const mainContent=document.getElementById('main-content');if(mainContent){mainContent.innerHTML=state.content;}
const sidebar=document.querySelector('.sidebar');if(sidebar){if(state.sidebarState){sidebar.classList.add('active');}else{sidebar.classList.remove('active');}}
setTimeout(()=>{performHistoryInitialization();isHistoryRestoringState=false;},100);}catch(error){console.error('状態復元エラー:',error);isHistoryRestoringState=false;window.location.reload();}}
function handleHtmxAfterSettle(){if(!isHistoryRestoringState){setTimeout(()=>{saveCompleteState();},50);}}
function handlePopState(event){initializeLogoutState();if((event.state&&event.state.logout)||isLoggedOut){window.location.replace('/auth/login');return false;}
if(event.state&&event.state.content){restoreCompleteState(event.state);}else{window.location.reload();}}
function startLogoutMonitoring(){setInterval(()=>{if(isLoggedOut&&window.location.pathname!=='/auth/login'){window.location.replace('/auth/login');}},200);}
function handleLogoutClick(){setupLogoutHistory();startLogoutMonitoring();const mainContent=document.getElementById('main-content');if(mainContent){mainContent.innerHTML='<div class="text-center mt-5"><h3>ログアウト中...</h3></div>';}
return true;}
function initializeHistoryManagement(){$(document).off(`htmx:afterSettle.${HISTORY_MANAGEMENT_NAMESPACE}`).on(`htmx:afterSettle.${HISTORY_MANAGEMENT_NAMESPACE}`,handleHtmxAfterSettle);$(document).off(`click.${HISTORY_MANAGEMENT_NAMESPACE}`,'.logout-button').on(`click.${HISTORY_MANAGEMENT_NAMESPACE}`,'.logout-button',handleLogoutClick);window.removeEventListener('popstate',handlePopState);window.addEventListener('popstate',handlePopState);setTimeout(saveCompleteState,100);}
$(document).ready(function(){if(window.location.pathname==='/auth/login'){clearLogoutState();return;}
initializeLogoutState();if(document.querySelector('.sidebar')){clearLogoutState();}
if(isLoggedOut){window.location.href='/auth/login';return;}
initializeHistoryManagement();});$(window).on('beforeunload',function(){$(document).off(`.${HISTORY_MANAGEMENT_NAMESPACE}`);window.removeEventListener('popstate',handlePopState,true);});;