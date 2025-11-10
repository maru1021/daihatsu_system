from daihatsu.log import error_logger, security_logger, local_error_logger

def except_output(title, e, type='error'):
    if type == 'error':
        error_logger.error(f'{title}: {str(e)}', exc_info=True)
    elif type == 'security':
        # セキュリティログでは例外情報を出力しない
        message = f'{title}: {str(e)}'
        security_logger.warning(message)
    elif type == 'local_error':
        local_error_logger.error(f'{title}: {str(e)}', exc_info=True)
