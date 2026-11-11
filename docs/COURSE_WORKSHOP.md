# Course Workshop

Open `course-editor.html` from the game or the character/kart studio.

- Import GLB, GLTF or FBX course models (select companion files such as textures and buffers alongside the model).
- Select a model in the list and adjust its position, Y rotation and uniform scale.
- Import an equirectangular 360-degree image as the scene skybox.
- Import an audio file and preview it with the built-in audio player.
- Save the workshop project in IndexedDB in the current browser profile and export a JSON project manifest.

This is currently a visual authoring and preview workspace. It does not yet replace the shipped course's road graph, collision/KCL, checkpoints, spawn points, or race rules, and imported music/skybox/course assets are not yet wired into an active race. The existing race physics and stock course remain unchanged.