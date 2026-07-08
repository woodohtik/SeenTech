import os

with open("src/components/GlobalRoleManager.tsx", "r") as f:
    content = f.read()

target = """    } catch (error: any) {
      console.error('Error saving role:', error);
      setToast({ message: `فشل الحفظ: ${error.message || 'خطأ غير معروف'}`, type: 'error' });
    }
  };"""

replacement = """    } catch (error: any) {
      console.error('Error saving role:', error);
      setToast({ message: `فشل الحفظ: ${error.message || 'خطأ غير معروف'}`, type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };"""

content = content.replace(target, replacement)

with open("src/components/GlobalRoleManager.tsx", "w") as f:
    f.write(content)
