export const getAuthErrorMessage = (err: any): string => {
  if (!err) return 'حدث خطأ غير متوقع أثناء تسجيل الدخول.';

  const code = typeof err === 'string' ? err : err.code || '';
  const message = typeof err === 'string' ? err : err.message || '';

  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة. يرجى التحقق وإعادة المحاولة.';
  }
  if (code === 'auth/email-already-in-use') {
    return 'هذا البريد الإلكتروني مسجل بالفعل في النظام. يرجى تسجيل الدخول بدلاً من إنشاء حساب جديد.';
  }
  if (code === 'auth/invalid-email') {
    return 'صيغة البريد الإلكتروني غير صحيحة. يرجى كتابة بريد إلكتروني صحيح.';
  }
  if (code === 'auth/weak-password') {
    return 'كلمة المرور ضعيفة جداً. يجب أن تتكون من 6 خانات أو أحرف على الأقل.';
  }
  if (code === 'auth/too-many-requests') {
    return 'تم تقييد المحاولات مؤقتاً بسبب تكرار إدخال بيانات خاطئة. يرجى الانتظار دقيقة ثم المحاولة مجدداً.';
  }
  if (code === 'auth/network-request-failed') {
    return 'فشل الاتصال بخوادم المصادقة. يرجى التأكد من اتصال الإنترنت وإيقاف إضافات حجب الإعلانات.';
  }
  if (code === 'auth/popup-closed-by-user') {
    return 'تم إغلاق نافذة المصادقة بواسطة المستخدم.';
  }
  if (code === 'auth/popup-blocked') {
    return 'تم حظر النافذة المنبثقة من قبل المتصفح. يرجى السماح بالنوافذ المنبثقة لهذا الموقع.';
  }

  // Fallback checks for string error messages
  if (message.includes('auth/invalid-credential') || message.includes('auth/wrong-password') || message.includes('auth/user-not-found')) {
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة. يرجى التحقق وإعادة المحاولة.';
  }
  if (message.includes('auth/email-already-in-use')) {
    return 'هذا البريد الإلكتروني مسجل بالفعل. يرجى تسجيل الدخول.';
  }
  if (message.includes('Firebase: Error') || message.startsWith('Firebase:')) {
    return 'بيانات الدخول غير صحيحة أو الحساب غير موجود. يرجى التحقق وإعادة المحاولة.';
  }

  return message || 'حدث خطأ أثناء المصادقة.';
};
