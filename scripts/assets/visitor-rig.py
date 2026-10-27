import argparse, hashlib, sys
import bpy,numpy as np
from mathutils import Quaternion,kdtree
from pathlib import Path
parser=argparse.ArgumentParser(description="修復済みNPCに待機・小さな挨拶の骨格アニメーションを追加する")
parser.add_argument("source",type=Path,help="Meshopt圧縮前の修復済みGLB")
parser.add_argument("output",type=Path,help="アニメーション付きGLBの出力先")
parser.add_argument("--mask",type=Path,default=Path(__file__).with_name("visitor-rig-mask.npz"))
parser.add_argument("--blend",type=Path,help="編集用Blenderファイルの保存先")
args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
expected="cd56edb5edd02cf4312cb88be6aebc8106de042ece664be29217549a88457931"
if hashlib.sha256(args.source.read_bytes()).hexdigest()!=expected:
 raise ValueError("入力GLBがリグ用に検証した修復済みモデルと一致しません")
if args.source.resolve()==args.output.resolve():raise ValueError("元GLBの上書きはできません")
if args.blend and args.blend.resolve() in {args.source.resolve(), args.output.resolve(), args.mask.resolve()}:
 raise ValueError("Blenderファイルは入力・出力GLBやマスクと別の場所に保存してください")
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(args.source))
mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH');mesh.name='VisitorMesh'
selection=np.load(args.mask,allow_pickle=False); selected=np.concatenate([selection[k] for k in selection.files if k.startswith('positions_')]);kd=kdtree.KDTree(len(selected))
for i,p in enumerate(selected):kd.insert((float(p[0]),float(-p[2]),float(p[1])),i)
kd.balance();xyz=np.array([v.co[:] for v in mesh.data.vertices]);distance=np.array([kd.find(v)[2] for v in xyz]);h=xyz[:,2];lateral=-xyz[:,1];x=xyz[:,0]
def smooth(t):
 t=np.clip(t,0,1);return t*t*(3-2*t)
# UVの継ぎ目で重みを共有し、メッシュの辺に沿って滑らかにする。
_,wid=np.unique(np.round(xyz,5),axis=0,return_inverse=True);nw=wid.max()+1
arm=np.zeros(nw,dtype=np.float64);np.maximum.at(arm,wid,(distance<.000008).astype(float))
ed=np.empty((len(mesh.data.edges),2),dtype=np.int32);mesh.data.edges.foreach_get('vertices',ed.ravel());ed=wid[ed];valid=ed[:,0]!=ed[:,1];ed=ed[valid];ed=np.unique(np.sort(ed,axis=1),axis=0);left=np.r_[ed[:,0],ed[:,1]];right=np.r_[ed[:,1],ed[:,0]];degree=np.maximum(np.bincount(left,minlength=nw),1)
for i in range(36):
 average=np.bincount(left,weights=arm[right],minlength=nw)/degree
 arm=.63*arm+.37*average
arm=arm[wid]
# 首元と頭を保ちながら肩の重みを滑らかに切り替える。
arm*=1-smooth((h-.182)/.050)
# 肘と手首で重みを滑らかに切り替え、前腕と手を動かす。
hand=arm*(1-smooth((h+.050)/.040)); upper=arm*smooth((h-.075)/.035);fore=arm-upper-hand;fore=np.maximum(fore,0)
head=smooth((h-.235)/.065)*(1-arm);root=np.maximum(0,1-arm-head)
# 肩の境目を含めて頂点ごとの重みの合計を1にする。
tot=root+upper+fore+hand+head;tot=np.maximum(tot,1e-9)
weights={'root':root/tot,'upper_arm':upper/tot,'forearm':fore/tot,'hand':hand/tot,'head':head/tot}
armdata=bpy.data.armatures.new('VisitorRig');rig=bpy.data.objects.new('VisitorRig',armdata);bpy.context.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
def bone(name,head,tail,parent=None):
 b=armdata.edit_bones.new(name);b.head=head;b.tail=tail
 if parent:b.parent=armdata.edit_bones[parent]
 return b
bone('root',(0,0,-.35),(0,0,.2))
bone('head',(0,0,.245),(0,0,.40),'root')
bone('upper_arm',(-.020,-.073,.2),(-.020,-.105,.09),'root')
bone('forearm',(-.020,-.105,.09),(.004,-.153,-.032),'upper_arm')
bone('hand',(.004,-.153,-.032),(.012,-.177,-.07),'forearm')
bpy.ops.object.mode_set(mode='OBJECT')
for name,values in weights.items():
 group=mesh.vertex_groups.new(name=name)
 for i,w in enumerate(values):
  if w>.0001:group.add([i],float(w),'REPLACE')
mod=mesh.modifiers.new('Visitor skin','ARMATURE');mod.object=rig;mesh.parent=rig
rig.animation_data_create()
for pb in rig.pose.bones:pb.rotation_mode='QUATERNION'
def world_quat(name,axis,angle):
 b=rig.data.bones[name]; q=b.matrix_local.to_quaternion();return q.inverted() @ Quaternion(axis,angle) @ q
def insert(name,frame,angle,axis=(1,0,0)):
 pb=rig.pose.bones[name];pb.rotation_quaternion=world_quat(name,axis,angle);pb.keyframe_insert(data_path='rotation_quaternion',frame=frame,group=name)
def action(name,frames):
 act=bpy.data.actions.new(name);rig.animation_data.action=act
 for frame,upper,fore,hand,head in frames:
  for bone,angle,axis in [('upper_arm',upper,(1,0,0)),('forearm',fore,(1,0,0)),('hand',hand,(1,0,0)),('head',head,(0,1,0))]:insert(bone,frame,angle,axis)
 for curve in act.fcurves:
  for key in curve.keyframe_points:key.interpolation='BEZIER';key.handle_left_type='AUTO_CLAMPED';key.handle_right_type='AUTO_CLAMPED'
 rig.animation_data.action=None;track=rig.animation_data.nla_tracks.new();track.name=name;track.strips.new(name,1,act)
 return act
act_idle=action('idle',[(1,0,0,0,0),(37,0,0,0,.035),(73,0,0,0,0),(109,0,0,0,-.035),(145,0,0,0,0)])
act_wave=action('wave',[(1,0,0,0,0),(17,0,-.035,0,.015),(32,0,-.07,-.12,.025),(44,0,-.07,.8,.025),(56,0,-.07,-.8,.025),(68,0,-.07,.8,.025),(80,0,-.07,-.8,.025),(92,0,-.07,.12,.025),(110,0,-.035,0,.015),(125,0,0,0,0)])
bpy.context.scene.render.fps=30
# 編集用ファイルを必要に応じて保存し、NLAトラックを個別のGLBアニメーションとして書き出す。
bpy.context.scene.frame_set(1)
if args.blend:bpy.ops.wm.save_as_mainfile(filepath=str(args.blend))
bpy.ops.export_scene.gltf(filepath=str(args.output),export_format='GLB',export_animations=True,export_animation_mode='NLA_TRACKS',export_skins=True,export_apply=False,export_image_format='AUTO',export_force_sampling=True)
print('weights',[(k,int(np.sum(v>.01)),float(np.max(v))) for k,v in weights.items()])
