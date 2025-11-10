from django.shortcuts import render, redirect
from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.mixins import LoginRequiredMixin
from django.contrib import messages
from django.http import JsonResponse
from django.views import View


class PasswordChangeView(LoginRequiredMixin, View):
    """ログインユーザー自身のパスワード変更ビュー"""

    def get(self, request, *args, **kwargs):
        """GETリクエスト処理"""
        context = {'page_title': 'パスワード変更'}

        # HTMXリクエストの場合はコンテンツ部分のみ返す
        if request.headers.get('HX-Request'):
            return render(request, 'auth/password_change/content.html', context)

        # 通常リクエストはフルページ返す
        return render(request, 'auth/password_change/full_page.html', context)

    def post(self, request, *args, **kwargs):
        """POSTリクエスト処理 - パスワード変更"""
        # 入力データの取得と検証
        validation_result = self._validate_password_input(request.POST, request.user)

        if validation_result['is_valid']:
            # パスワード変更とセッション維持
            user = self._change_password(request.user, validation_result['data']['new_password1'])
            update_session_auth_hash(request, user)

            return JsonResponse({
                'status': 'success',
                'message': 'パスワードが正常に変更されました。'
            })
        else:
            # バリデーションエラーの場合
            return JsonResponse({
                'status': 'error',
                'message': 'パスワードの変更に失敗しました。以下の内容を確認してください。',
                'error_details': validation_result['errors']
            }, status=400)

    def _validate_password_input(self, post_data, user):
        """パスワード入力データのバリデーション"""
        errors = []
        data = {}

        # 現在のパスワードの検証
        old_password = post_data.get('old_password', '').strip()
        if not old_password:
            errors.append('現在のパスワード: この項目は必須です。')
        elif not user.check_password(old_password):
            errors.append('現在のパスワード: 現在のパスワードが正しくありません。')
        else:
            data['old_password'] = old_password

        # 新しいパスワードの検証
        new_password1 = post_data.get('new_password1', '').strip()
        if not new_password1:
            errors.append('新しいパスワード: この項目は必須です。')
        else:
            # パスワード強度チェック
            password_errors = self._validate_password_strength(new_password1, user)
            errors.extend(password_errors)
            if not password_errors:
                data['new_password1'] = new_password1

        # パスワード確認の検証
        new_password2 = post_data.get('new_password2', '').strip()
        if not new_password2:
            errors.append('パスワード確認: この項目は必須です。')
        elif new_password1 and new_password1 != new_password2:
            errors.append('パスワード確認: 新しいパスワードが一致しません。')
        else:
            data['new_password2'] = new_password2

        return {
            'is_valid': len(errors) == 0,
            'data': data,
            'errors': errors
        }

    def _validate_password_strength(self, password, user):
        """パスワード強度のバリデーション"""
        errors = []

        # 基本的なバリデーション
        if len(password) < 8:
            errors.append('新しいパスワード: パスワードは8文字以上である必要があります。')

        if password.isdigit():
            errors.append('新しいパスワード: パスワードは数字のみでは設定できません。')

        # 一般的なパスワードをチェック
        common_passwords = ['password', '12345678', '123456789', 'qwerty', 'abc123']
        if password.lower() in common_passwords:
            errors.append('新しいパスワード: このパスワードは一般的すぎます。別のパスワードを選択してください。')

        # ユーザー名との類似性をチェック
        if user.username and user.username.lower() in password.lower():
            errors.append('新しいパスワード: パスワードはユーザー名と類似しすぎています。')

        return errors

    def _change_password(self, user, new_password):
        """パスワードを変更"""
        user.set_password(new_password)
        user.save()
        return user
