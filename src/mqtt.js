/**
 * @fileoverview Handle messaging from MQTT
 *
 * Open source software under the terms in /LICENSE
 * Copyright (c) 2020, The CONIX Research Center. All rights reserved.
 * @date 2020
 */

/* global THREE, ARENA */

// 'use strict';
import * as Comlink from '../vendor/comlink/comlink.mjs';
import {ClientEvent, CreateUpdate, Delete} from './message-actions/';

/**
 * Main ARENA MQTT client
 */
export class ARENAMqtt {
    // eslint-disable-next-line require-jsdoc
    static async init() {
        const mqtt = new ARENAMqtt();
        await mqtt._initWorker();
        return mqtt;
    }

    constructor() {
        this.MQTTWorker = undefined;
        this.mqttClient = undefined;
    }

    async _initWorker() {
        const MQTTWorker = Comlink.wrap(new Worker('../workers/mqtt-worker.js'));
        const worker = await new MQTTWorker({
            ARENAConfig: {
                renderTopic: ARENA.renderTopic,
                mqttHostURI: ARENA.mqttHostURI,
                idTag: ARENA.idTag,
            },
            initScene: Comlink.proxy(ARENA.initScene),
            mainOnMessageArrived: Comlink.proxy(this._onMessageArrived),
            restartJitsi: Comlink.proxy(() => {
                if (ARENA.Jitsi) {
                    if (!ARENA.Jitsi.ready) {
                        ARENA.Jitsi = ARENA.Jitsi(ARENA.jitsiServer);
                        console.warn(`ARENA Jitsi restarting...`);
                    }
                }
            }),
        );
        console.log('MQTT Worker initialized');
        this.MQTTWorker = worker;
        this.mqttClient = worker.mqttClient;
    }

    /**
     * Internal MessageArrived handler; handles object create/delete/event/... messages
     * @param {Object} message
     * @param {String} jsonMessage
     */
    _onMessageArrived(message, jsonMessage) {
        let theMessage = {};

        if (message) {
            try {
                theMessage = JSON.parse(message.payloadString);
            } catch { }
        } else if (jsonMessage) {
            theMessage = jsonMessage;
        }

        if (!theMessage) {
            console.warn('Received empty message');
            return;
        }

        if (theMessage.object_id === undefined) {
            console.warn('Malformed message (no object_id):', JSON.stringify(message));
            return;
        }

        if (theMessage.action === undefined) {
            console.warn('Malformed message (no action field):', JSON.stringify(message));
            return;
        }

        // rename object_id to match internal handlers (and aframe)
        theMessage.id = theMessage.object_id;
        delete theMessage.object_id;

        switch (theMessage.action) { // clientEvent, create, delete, update
        case 'clientEvent':
            if (theMessage.data === undefined) {
                console.warn('Malformed message (no data field):', JSON.stringify(message));
                return;
            }
            ClientEvent.handle(theMessage);
            break;
        case 'create':
        case 'update':
            if (theMessage.data === undefined) {
                console.warn('Malformed message (no data field):', JSON.stringify(message));
                return;
            }
            CreateUpdate.handle(theMessage.action, theMessage);
            break;
        case 'delete':
            Delete.handle(theMessage);
            break;
        case 'getPersist':
        case 'returnPersist':
            break;
        default:
            console.warn('Malformed message (invalid action field):', JSON.stringify(message));
            break;
        }
    }

    async connect(mqttClientOptions, lwMsg=undefined, lwTopic=undefined) {
        await this.MQTTWorker.connect(Comlink.proxy(mqttClientOptions), lwMsg, lwTopic);
    }
    async send(msg) {
        await this.MQTTWorker.send(msg);
    }
    async publish(dest, msg) {
        await this.MQTTWorker.publish(dest, msg);
    }
    /**
     * Send a message to internal receive handler
     * @param {string} jsonMessage
     */
    processMessage(jsonMessage) {
        return this._onMessageArrived(undefined, jsonMessage);
    }
    async isConnected() {
        return await this.MQTTWorker.isConnected();
    }
};
