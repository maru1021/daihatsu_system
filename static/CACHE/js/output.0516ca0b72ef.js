function getBasePageInfo(){let currentPage='1';let currentSearch='';const urlParams=new URLSearchParams(window.location.search);const urlPage=urlParams.get('page');const urlSearch=urlParams.get('search');if(urlPage){currentPage=urlPage;}
if(urlSearch!==null){currentSearch=urlSearch;}
if(!urlPage){const activePageElement=document.querySelector('.pagination .page-item.active .page-link');if(activePageElement){const pageFromDOM=activePageElement.textContent.trim();if(pageFromDOM&&!isNaN(pageFromDOM)){currentPage=pageFromDOM;}}}
return{page:currentPage,search:currentSearch};}
function getFormPageInfo(){const baseInfo=getBasePageInfo();const searchInput=document.querySelector('input[name="search"]');if(searchInput&&baseInfo.search===''){baseInfo.search=searchInput.value||'';}
return baseInfo;}
function getDeletePageInfo(){return getBasePageInfo();};