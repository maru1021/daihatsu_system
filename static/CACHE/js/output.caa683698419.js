function showModal(modalId){const modal=new bootstrap.Modal($(`#${modalId}`));modal.show();}
function hideModal(modalId){const modal=bootstrap.Modal.getInstance($(`#${modalId}`));modal.hide();}
function cleanupModals(){$('.modal-backdrop').remove();$('body').removeClass('modal-open');$('body').css('overflow','');$('body').css('padding-right','');}
function updateModalMessage(message){$('.delete-modal-message').text(message);}
function showRegisterModal(){const registerButton=$('#register-button');registerButton.off('click').on('click',function(evt){resetRegisterForm($('#RegisterForm'));showModal('RegisterModal');});};