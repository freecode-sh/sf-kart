# Course Workshop

Open `course-editor.html` from the game or the character/kart studio.

- Import GLB, GLTF or FBX course models (select all companion textures and buffers alongside each model).
- Select a model in the list and adjust its position, Y rotation and uniform scale.
- Import an equirectangular 360-degree image as the scene skybox.
- Import an audio file and preview it with the built-in audio player.
- Save the workshop project in IndexedDB in the current browser profile and export a JSON project manifest.

## Using a workshop project in a race

The race renderer now loads saved course models as decorative scenery and applies the saved skybox to the active scene. If a music file is saved, the race uses it instead of the procedural San Francisco soundtrack; it starts at the race start and pauses with the game. Reopen the Course Workshop and save after making changes so the next race can pick them up.

**Important limits:** this is not yet a full track-geometry editor. Imported models do not generate a drivable road, KCL collision, checkpoints, a centerline, minimap or spawn points. The shipped San Francisco course, road graph, collision and race rules still drive the kart. Place scenery models relative to that course using the workshop transforms. Custom character roster entries are saved locally in the browser and can be selected as the active character in the Garage.
