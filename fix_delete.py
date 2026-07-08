import os

with open("src/components/Staff.tsx", "r") as f:
    content = f.read()

target = """    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'roles');
      setToast({ message: 'فشل حذف المهنة', type: 'error' });
    } finally {"""

replacement = """    } catch (err: any) {
      console.error("Error deleting role:", err);
      setToast({ message: err?.message || 'فشل حذف المهنة', type: 'error' });
    } finally {"""

content = content.replace(target, replacement)

with open("src/components/Staff.tsx", "w") as f:
    f.write(content)
