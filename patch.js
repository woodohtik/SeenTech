const fs = require('fs');
let code = fs.readFileSync('src/components/GlobalRoleManager.tsx', 'utf-8');

code = code.replace(
  "const handleSaveRole = async () => {\n    const roleToSave = editingRole || newRole;\n    if (!roleToSave.name) return;\n\n    try {",
  "const handleSaveRole = async () => {\n    const roleToSave = editingRole || newRole;\n    if (!roleToSave.name || isSaving) return;\n\n    setIsSaving(true);\n    try {"
);

code = code.replace(
  "} catch (error: any) {\n      console.error('Error saving role:', error);\n      setToast({ message: `فشل الحفظ: ${error.message || 'خطأ غير معروف'}`, type: 'error' });\n    }\n  };",
  "} catch (error: any) {\n      console.error('Error saving role:', error);\n      setToast({ message: `فشل الحفظ: ${error.message || 'خطأ غير معروف'}`, type: 'error' });\n    } finally {\n      setIsSaving(false);\n    }\n  };"
);

code = code.replace(
  "  const handleDeleteRole = async (id: string) => {\n    if (!window.confirm('هل أنت متأكد من حذف هذه المهنة؟ سيؤثر ذلك على جميع المشتركين الذين يستخدمونها.')) return;\n    try {\n      const { error } = await supabase\n        .from('roles')\n        .delete()\n        .eq('id', id);\n      if (error) throw error;\n      setToast({ message: 'تم حذف المهنة بنجاح', type: 'success' });\n      await fetchRoles();\n    } catch (error: any) {\n      console.error('Error deleting role:', error);\n      setToast({ message: `فشل الحذف: ${error.message || 'خطأ غير معروف'}`, type: 'error' });\n    }\n  };",
  "  const confirmDeleteRole = (role: Role) => {\n    setRoleToDelete(role);\n  };\n\n  const executeDeleteRole = async () => {\n    if (!roleToDelete || isSaving) return;\n\n    setIsSaving(true);\n    try {\n      const { error } = await supabase\n        .from('roles')\n        .delete()\n        .eq('id', roleToDelete.id);\n      if (error) throw error;\n      setToast({ message: 'تم حذف المهنة بنجاح', type: 'success' });\n      await fetchRoles();\n      setRoleToDelete(null);\n    } catch (error: any) {\n      console.error('Error deleting role:', error);\n      setToast({ message: `فشل الحذف: ${error.message || 'خطأ غير معروف'}`, type: 'error' });\n    } finally {\n      setIsSaving(false);\n    }\n  };"
);

code = code.replace(
  "onClick={() => handleDeleteRole(role.id)}",
  "onClick={() => confirmDeleteRole(role)}"
);

fs.writeFileSync('src/components/GlobalRoleManager.tsx', code);
