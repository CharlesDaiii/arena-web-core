/**
 * @fileoverview Import A-Frame Systems used
 *
 * Open source software under the terms in /LICENSE
 * Copyright (c) 2020, The CONIX Research Center. All rights reserved.
 * @date Jan, 2021
 */

/**
 * ARENA A-Frame systems
 */

// Vendor override/imports
import 'aframe-extras'; // gltf animations, components for controls, model loaders, pathfinding
import './vendor/nav-system'; // Override nav system

import './core'; // ARENA core systems
import './ui'; // 2D UI systems
import './postprocessing'; // post-processing
import './hybrid-rendering'; // hybrid rendering
import './webar';
import './webxr'; // special handler for webxr devices

import './ar-hit-test-listener';
import './armarker';
import './attribution';
import './build-watch-scene';
import './screenshare';
import './stats-monitor';
