# Custom models and Garage

Open the **Garage & model editor** link from the race page, or visit `/garage.html`.

## Importing assets

Choose one slot (Character, Kart body or Tires), then select the model and any companion files:

- **GLB**: recommended; a single file can contain meshes, materials, textures and animation clips.
- **GLTF**: select the `.gltf` file plus its referenced `.bin` and texture files.
- **FBX**: select the `.fbx` file plus its referenced texture files. Skeletal animation clips are shown when present.

Choose the main model file in the dropdown and select **Load into studio**. Models are saved in the browser's IndexedDB library and restored on the next visit. Imported files stay in that browser; they are not uploaded to the repository or a server.

## Positioning and animation

Select a slot to edit it. Move, Rotate and Scale use the 3D transform gizmo; the numeric fields allow precise XYZ position, rotation (degrees) and scale values. **Reset** restores the slot's default transform. **Frame model** focuses the camera on the selected model. The viewport supports orbit and zoom.

Character animation clips can be selected, played, paused, looped, scrubbed and previewed at different playback speeds.

**Export setup** downloads a JSON snapshot of the slot transforms and loaded model filenames. It does not embed the 3D files; those remain in browser storage.

## Using custom visuals in races

The race renderer loads the saved character, kart and tire assets from the same browser profile. Custom visuals replace the corresponding stock visual where supported. Tire meshes are placed at the physics engine's wheel centers.

The existing vehicle physics, collision, handling, wheel suspension and course simulation remain authoritative. Custom model imports are visual assets; they do not automatically create new physics hitboxes, wheel suspension settings or vehicle performance data. The character's first animation clip is used during a race when a custom character has animation clips; the Garage is where clips can be previewed and selected.

If browser storage is cleared, imported models and saved transforms are removed. Keep original source files backed up.
