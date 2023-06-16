/**
 * @fileoverview Handle messaging from MQTT
 *
 * Open source software under the terms in /LICENSE
 * Copyright (c) 2023, The CONIX Research Center. All rights reserved.
 * @date 2023
 */

/* global ARENA */

// 'use strict';
import { proxy, wrap} from 'comlink';
import { ARENADefaults } from '../../conf/defaults.js';
import { ClientEvent, CreateUpdate, Delete} from '../message-actions/index.js';
import { ARENA_EVENTS } from '../constants';
import { ACTIONS } from '../constants';

const warn = AFRAME.utils.debug('ARENA:MQTT:warn');
const error = AFRAME.utils.debug('ARENA:MQTT:error');

AFRAME.registerSystem('arena-mqtt', {
    schema: {
        mqttHost: {type: 'string', default: ARENADefaults.mqttHost},
        mqttPath: {type: 'array', default: ARENADefaults.mqttPath},
    },

    init: function () {
        ARENA.events.addEventListener(ARENA_EVENTS.USER_PARAMS_LOADED, this.ready.bind(this));
    },
    ready: async function () {
        const data = this.data;
        const el = this.el;

        const sceneEl = el.sceneEl;

        this.arena = sceneEl.systems['arena-scene'];
        this.health = sceneEl.systems['arena-health-ui'];

        // set up MQTT params for worker
        this.userName = this.arena.mqttToken.mqtt_username;
        this.mqttHost = ARENA.params.mqttHost ?? data.mqttHost;
        this.mqttHostURI = 'wss://' + this.mqttHost + data.mqttPath[Math.floor(Math.random() * data.mqttPath.length)];

        this.MQTTWorker = await this.initWorker();

        const mqttToken = this.arena.mqttToken.mqtt_token;
        const camName = this.arena.camName;
        const outputTopic = this.arena.outputTopic;
        // Do not pass functions in mqttClientOptions
        this.connect(
            {
                reconnect: true,
                userName: this.userName,
                password: mqttToken,
            },
            proxy(() => {
                console.info("ARENA MQTT scene connection success!");
                ARENA.events.emit(ARENA_EVENTS.MQTT_LOADED, true);
            }),
            // last will message
            JSON.stringify({ object_id: camName, action: "delete" }),
            // last will topic
            outputTopic + camName
        );

        ARENA.Mqtt = this; // Restore old alias
    },

    initWorker: async function() {
        const data = this.data;
        const el = this.el;

        const renderTopic = this.arena.renderTopic;
        const idTag = this.arena.idTag;

        const MQTTWorker = wrap(new Worker(new URL('./workers/mqtt-worker.js', import.meta.url), {type: 'module'}));
        const worker = await new MQTTWorker(
            {
                renderTopic: renderTopic,
                mqttHostURI: this.mqttHostURI,
                idTag: idTag,
            },
            proxy(this.mqttHealthCheck.bind(this))
            // proxy(() => {
            //     if (ARENA.Jitsi && !ARENA.Jitsi.initialized) {
            //         // eslint-disable-next-line new-cap
            //         ARENA.Jitsi = ARENA.Jitsi(ARENA.jitsiServer);
            //         warn(`ARENA Jitsi restarting...`);
            //     }
            // }),
        );
        worker.registerMessageHandler("s", proxy(this.onSceneMessageArrived.bind(this)), true);
        return worker;
    },

    /**
     * @param {object} mqttClientOptions
     * @param {function} [onSuccessCallBack]
     * @param {string} [lwMsg]
     * @param {string} [lwTopic]
     */
    connect(mqttClientOptions, onSuccessCallBack = undefined, lwMsg = undefined, lwTopic = undefined) {
        this.MQTTWorker.connect(mqttClientOptions, onSuccessCallBack, lwMsg, lwTopic);
    },

    /**
     * Internal callback to pass MQTT connection health to ARENAHealth.
     * @param {object} msg Message object like: {addError: 'mqttScene.connection'}
     */
    mqttHealthCheck: function(msg) {
        if (msg.removeError) this.health.removeError(msg.removeError);
        else if (msg.addError) this.health.addError(msg.addError);
    },

    /**
     * Publishes message to mqtt
     * @param {string} topic
     * @param {string|object} payload
     * @param {number} qos
     * @param {boolean} retained
     */
    publish: async function(topic, payload, qos=0, retained=false) {
        await this.MQTTWorker.publish(topic, payload, qos, retained);
    },

    /**
     * Send a message to internal receive handler
     * @param {object} jsonMessage
     */
    processMessage: function(jsonMessage) {
        this.onSceneMessageArrived({ payloadObj: jsonMessage });
    },

    /**
     * Returns mqttClient connection state
     * @return {boolean}
     */
    isConnected: async function() {
        const client = this.MQTTWorker.mqttClient;
        const isConnected = await client.isConnected();
        return isConnected;
    },

    /**
     * MessageArrived handler for scene messages; handles object create/delete/event... messages
     * This message is expected to be JSON
     * @param {object} message
     */
    onSceneMessageArrived: function(message) {
        const theMessage = message.payloadObj; // This will be given as json

        if (!theMessage) {
            warn('Received empty message');
            return;
        }

        if (theMessage.object_id === undefined) {
            warn('Malformed message (no object_id):', JSON.stringify(message));
            return;
        }

        if (theMessage.action === undefined) {
            warn('Malformed message (no action field):', JSON.stringify(message));
            return;
        }

        // rename object_id to match internal handlers (and aframe)
        theMessage.id = theMessage.object_id;
        delete theMessage.object_id;

        let topicUser;
        if (message.destinationName) {
            // This is a Paho.MQTT.Message
            topicUser = message.destinationName.split('/')[4];
        }

        switch (theMessage.action) { // clientEvent, create, delete, update
        case ACTIONS.CLIENT_EVENT:
            if (theMessage.data === undefined) {
                warn('Malformed message (no data field):', JSON.stringify(message));
                return;
            }
            // check topic
            if (message.destinationName) {
                if (topicUser !== theMessage.data.source) {
                    warn('Malformed message (topic does not pass check):', JSON.stringify(message), message.destinationName);
                    return;
                }
            }
            ClientEvent.handle(theMessage);
            break;
        case ACTIONS.CREATE:
        case ACTIONS.UPDATE:
            if (theMessage.data === undefined) {
                warn('Malformed message (no data field):', JSON.stringify(message));
                return;
            }
            // check topic
            if (message.destinationName) {
                if (!message.destinationName.endsWith(`/${theMessage.id}`)) {
                    warn('Malformed message (topic does not pass check):', JSON.stringify(message), message.destinationName);
                    return;
                }
            }
            CreateUpdate.handle(theMessage.action, theMessage);
            break;
        case ACTIONS.DELETE:
            // check topic
            if (message.destinationName) {
                if (!message.destinationName.endsWith(`/${theMessage.id}`)) {
                    warn('Malformed message (topic does not pass check):', JSON.stringify(message), message.destinationName);
                    return;
                }
            }
            Delete.handle(theMessage);
            break;
        case ACTIONS.GET_PERSIST:
        case ACTIONS.RETURN_PERSIST:
            break;
        default:
            warn('Malformed message (invalid action field):', JSON.stringify(message));
            break;
        }
    },
});