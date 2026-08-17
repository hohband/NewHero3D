# 把未绑骨的 GLB 转成 FBX，供 Mixamo 上传自动绑骨用。无头 Blender 运行。
# 用法:
#   Blender --background --python glb_to_fbx.py -- <SRC.glb> <OUT.fbx>
import bpy, sys

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
bpy.ops.export_scene.fbx(
    filepath=OUT,
    use_selection=False,
    apply_scale_options='FBX_SCALE_NONE',
    global_scale=1.0,
    mesh_smooth_type='FACE',
)
print("EXPORTED_FBX:", OUT)
print("DONE")
