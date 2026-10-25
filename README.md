# bedrock-skin-gltf

Minecraft Bedrock EditionのLoginパケットに入っているスキン (geometry・スキン画像) をglTF 2.0 (GLB) にするライブラリ。

出力はMinecraftのPersona API (`ModelBinary`) が返すGLBと同じ座標・単位・ノード名なので、同じ表示処理でそのまま並べて使える。

## 使い方

```ts
import { skinToGlb } from 'bedrock-skin-gltf';

const glb: Uint8Array = skinToGlb({
  skin: skinPng, // スキン画像 (PNG)
  geometry: JSON.parse(skinGeometryData), // SkinGeometryData (無ければ省略)
  resourcePatch: JSON.parse(skinResourcePatch), // SkinResourcePatch
  animatedImages: [personaPng], // AnimatedImageDataの画像 (PNG)
  armSize: 'wide', // geometryが無いときの標準スキンの体型 (wide / slim)
  cape: capePng, // マントの画像 (PNG, 無ければ省略)
});
```

画像はPNGのまま埋め込むので、デコードはしない。

Loginパケットのclient data JWTのclaimsを、keyのまま渡すこともできる。RGBAの画像はPNGにして埋め込む。

```ts
import { clientDataToGlb } from 'bedrock-skin-gltf';

const glb: Uint8Array = clientDataToGlb({
  SkinData, // RGBA (base64)
  SkinImageWidth,
  SkinImageHeight,
  SkinGeometryData, // JSON (base64)
  SkinResourcePatch, // JSON (base64)
  ArmSize,
  AnimatedImageData, // [{ Image, ImageWidth, ImageHeight }]
  CapeData, // RGBA (base64)。空ならマント無し
  CapeImageWidth,
  CapeImageHeight,
});
```

claimsの他のkeyが入っていても無視する。

## 出力の形

Persona APIのGLBに合わせている。

- 座標はBedrockのgeometryのZを反転したもの (`x, y, -z`)。キャラクターは+Zを向き、右側が-X
- 単位はピクセルのまま (1ブロック = 16)。足元が原点
- ノードはgeometryのboneと同じ階層 (`root` → `waist` → `body` → `head` …)。名前は標準スキンと同じキャメルケース (`leftArm`など)
- メッシュも子も無いbone (`leftItem`など) は省く
- ノードの`translation`は親のpivotからの位置。頂点はboneのpivot基準
- マテリアルは`alphaMode: MASK`・`doubleSided`・NEARESTのサンプラー

resource patchの`default`はスキン画像、それ以外 (`animated_face`など) はテクスチャのサイズが同じアニメーション画像を使い、1フレーム目を表示する。

### 対応しているもの

- geometryの1.8.0形式と1.12.0以降の形式
- cubeのbox UV・面ごとのUV・`mirror`・`inflate`・pivotを中心にした回転
- boneの回転 (`rotation`)、`neverRender`
- `poly_mesh` (ペルソナスキン)
- geometryが無い標準スキン (`geometry.humanoid.custom` / `geometry.humanoid.customSlim`)
- マント (`geometry.cape`。`body`の子の`cape`ノードとして背中側に付く。風でなびく傾きは付けない)

### 対応していないもの

- 1.8.0形式の継承 (`geometry.foo:geometry.parent`) の親のbone
- `bind_pose_rotation`

## 開発

```bash
vp install
vp check
vp test
vp pack
```

テストは`fixtures/`に置いた実際のスキンを使う。プレイヤーのデータなのでリポジトリには含めない (`fixtures/`がなければスキップする)。

- `fixtures/skins/{名前}/`: `skin.png`・`geometry.json`・`skin_meta.json`・`persona_{n}.png`
  - `standard/`: 標準の人型 (wide) のスキン
  - `persona/`: ペルソナスキン (`poly_mesh`とアニメーション画像あり)
- `fixtures/persona-standard.glb`: Persona APIのGLB。`standard/`と同じアカウントのもので、形を比べる

## ライセンス

MIT
