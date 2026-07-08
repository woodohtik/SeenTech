import os

with open("src/components/GlobalRoleManager.tsx", "r") as f:
    content = f.read()

target = "          </div>\n        )}\n      </AnimatePresence>"

modal = """          </div>
        )}

        {roleToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isSaving && setRoleToDelete(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-8 overflow-hidden"
            >
              <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mb-6 mx-auto">
                <Trash2 size={32} className="text-rose-600" />
              </div>
              <h3 className="text-xl font-black text-gray-900 text-center mb-2">تأكيد الحذف</h3>
              <p className="text-sm font-medium text-gray-500 text-center mb-8">
                هل أنت متأكد من حذف مهنة "{roleToDelete.name}"؟ 
                <br />
                <span className="text-rose-600 font-bold">هذا الإجراء سيؤثر على المشتركين الذين يستخدمونها.</span>
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setRoleToDelete(null)}
                  disabled={isSaving}
                  className="flex-1 px-4 py-3 rounded-2xl font-black text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 transition-all disabled:opacity-50"
                >
                  إلغاء
                </button>
                <button
                  onClick={executeDeleteRole}
                  disabled={isSaving}
                  className="flex-1 px-4 py-3 rounded-2xl font-black text-sm text-white bg-rose-600 hover:bg-rose-700 transition-all shadow-lg shadow-rose-200 disabled:opacity-50 flex items-center justify-center"
                >
                  {isSaving ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'حذف المهنة'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>"""

content = content.replace(target, modal)

with open("src/components/GlobalRoleManager.tsx", "w") as f:
    f.write(content)
