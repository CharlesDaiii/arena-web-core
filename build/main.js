import * as PersistObjects from "./persist-objects.js"

var schema_files = { "object": { file: "arena-obj3d.json", description: "3D Object"}, "program": { file: "arena-program.json", description: "Program"} };

document.addEventListener('DOMContentLoaded', async function() {

    var schema;
    var jsoneditor;

    // Divs/textareas on the page
    var $output = document.getElementById('output');
    var $editor = document.getElementById('editor');
    var $validate = document.getElementById('validate');
    var $objlist = document.getElementById('objlist');
    var $scene = document.getElementById('arena_scene');
    var $mqtthost = document.getElementById('mqtt_host');
    var $arena_url = document.getElementById('arena_url');
    var $editmsg = document.getElementById('editmsg');

    // Buttons/Selects
    var $set_value_button = document.getElementById('setvalue');
    var $select_schema = document.getElementById('objtype');
    var $genid_button = document.getElementById('genid');
    var $add_button = document.getElementById('addobj');
    var $del_button = document.getElementById('delobj');
    var $clear_button = document.getElementById('clearlist');
    var $mqtt_reconnect =  document.getElementById('mqtt_reconnect');

    // add schema files to select
    for (var objtype in schema_files) {
        console.log(schema_files[objtype].file);
        var ofile = document.createElement("option");
        ofile.value = schema_files[objtype].file;
        ofile.appendChild( document.createTextNode(schema_files[objtype].description) );
        $select_schema.appendChild(ofile);
    }

    var data = await fetch('dft-config.json');
    var dfts = await data.json();
    console.log(dfts);

    // load values from fedaults or local storage, if they exist
    $select_schema.value = localStorage.getItem('schema_file') === null ? dfts.schema_file : localStorage.getItem('schema_file');
    $select_schema.dispatchEvent(new Event('change'));
    $scene.value = localStorage.getItem('scene') === null ? dfts.scene : localStorage.getItem('scene');
    $arena_url.value = localStorage.getItem('arena_url') === null ? dfts.arena_url : localStorage.getItem('arena_url');
    $mqtthost.value = localStorage.getItem('mqtthost') === null ? dfts.mqtthost : localStorage.getItem('mqtthost');

    // Scene config schema
    if (!schema) {
        data = await fetch('arena-obj3d.json');
        schema = await data.json();
    }


    var updateLink = function() {
        var scene_url = $arena_url.value.replace(/\/+$/, "") + "?scene=" + $scene.value /*+ "&mqttServer=" + $mqtthost.value;*/
        document.getElementById('scene_url').href = scene_url;
    };

    // when a host addr is changed; update settings
    var updateHost = async function() {
            // persist db might be at ARENA web host or mqtt host, depending on the deployment; try both
            var persist_urls = ['https://' + $mqtthost.value.replace(/\/+$/, "") + '/persist/', 
                                $arena_url.value.replace(/\/+$/, "") + '/persist/']
            
            await PersistObjects.fetchPersistURL(persist_urls);

            await PersistObjects.populateList($scene.value);
            reload();   
            updateLink();         
    }

    // try to split mqtt host from port
    var mqttHostAndPort = function(mqttHostStr) {
        var port = 443; // default value
        var host = mqttHostStr;
        var n = mqttHostStr.lastIndexOf(":");
        if (n > -1) {
            var p = parseInt(mqttHostStr.substring(n + 1, mqttHostStr.length));
            if (p != NaN) {
                port = parseInt(p);
                host = mqttHostStr.substring(0, n);
            }
        }
        return {
            mqtt_host: host,
            mqtt_port: port
        };
    };

    var reload = function(keep_value) {
        var startval = (jsoneditor && keep_value) ? jsoneditor.getValue() : window.startval;
        window.startval = undefined;

        //new ClipboardJS('.btn');

        if (jsoneditor) jsoneditor.destroy();
        jsoneditor = new JSONEditor($editor, {
            schema: schema,
            startval: startval
        });
        window.jsoneditor = jsoneditor;

        // When the value of the editor changes, update the JSON output and validation message
        jsoneditor.on('change', function() {
            var json = jsoneditor.getValue();

            $output.value = JSON.stringify(json, null, 2);

            var validation_errors = jsoneditor.validate();
            // Show validation errors if there are any
            if (validation_errors.length) {
                $validate.value = JSON.stringify(validation_errors, null, 2);
            } else {
                $validate.value = 'valid';
            }
        });
    };

    // we indicate this function as the edit handler to persist
    var editobjHandler = async function(obj) {
        // derive objtype from existence of attribute; TODO: save type in persit?
        var objtype = "object";
        if (obj.attributes.filename) objtype="program";

        var updateobj = {
            object_id: obj.object_id,
            action: "update",
            persist: true,
            type: objtype,
            data: obj.attributes
        };

        var schemaFile = schema_files[objtype].file;
        var data = await fetch(schemaFile);
        schema = await data.json();
        for (var opt, j = 0; opt = $select_schema[j]; j++) {
            if (opt.value == schema_files[objtype].file) {
                $select_schema.selectedIndex = j;
                break;
            }
        }
        if (jsoneditor) jsoneditor.destroy();
        jsoneditor = new JSONEditor($editor, {
            schema: schema,
            startval: updateobj
        });    
        window.jsoneditor = jsoneditor;    
        //window.jsoneditor = undefined;
        jsoneditor.setValue(updateobj);
        $output.value = JSON.stringify(updateobj, null, 2);
        reload(true);

        window.location.hash = 'edit_section';

        $editmsg.style.display = 'block';
        setTimeout(()=>{ $editmsg.style.display = 'none'; }, 5000); // clear message in 5 seconds
    }

    // Start the output textarea empty
    $output.value = '';

    // set defaults
    JSONEditor.defaults.options.display_required_only = true;
    JSONEditor.defaults.options.required_by_default = false;
    JSONEditor.defaults.options.theme = 'bootstrap2';
    document.getElementById('theme_stylesheet').href = '//netdna.bootstrapcdn.com/twitter-bootstrap/2.3.2/css/bootstrap-combined.min.css';
    JSONEditor.defaults.options.iconlib = 'fontawesome4';
    document.getElementById('icon_stylesheet').href = '//cdnjs.cloudflare.com/ajax/libs/font-awesome/4.0.3/css/font-awesome.css';
    JSONEditor.defaults.options.object_layout = 'normal';
    JSONEditor.defaults.options.show_errors = 'interaction';

    // When the 'update form' button is clicked, set the editor's value
    $set_value_button.addEventListener('click', function() {
        jsoneditor.setValue(JSON.parse($output.value));
    });

    // generate a random object_id
    $genid_button.addEventListener('click', function() {
        var obj = JSON.parse($output.value);
        // if object has an object_id field, auto create a uuid
        if (obj.object_id != undefined) {
            obj.object_id = ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
        }
        $output.value = JSON.stringify(obj, null, 2);
        jsoneditor.setValue(obj);
    });

    // Change listener for object type 
    $select_schema.addEventListener('change', async function() {
        var schemaFile = $select_schema.value;
        var data = await fetch(schemaFile);
        schema = await data.json();
        localStorage.setItem('schemaFile', schemaFile);
        reload();
    });

    var mqttConnData = mqttHostAndPort($mqtthost.value);
    
    // start persist object mngr
    PersistObjects.init({
        mqtt_host: mqttConnData.mqtt_host,
        mqtt_port: mqttConnData.mqtt_port,
        obj_list: document.getElementById("objlist"),
        log_panel: document.getElementById("logpanel"),
        editobj_handler: editobjHandler
    });

    // update options (including persist_url) from inputs
    await updateHost();

    PersistObjects.populateList($scene.value);

    // Change listener for scene
    $scene.addEventListener('change', async function() {
        PersistObjects.populateList($scene.value);
        reload();
        updateLink();
        localStorage.setItem('scene', $scene.value);
    });

    // Change listener for arena URL
    $arena_url.addEventListener('change', async function() {
        updateHost();
        localStorage.setItem('arena_url', $arena_url.value);
    });

    // Change listener for arena mqtt host
    $mqtthost.addEventListener('change', async function() {
        updateHost();
        PersistObjects.log("MQTT host changed; Press refresh to apply them.");
        localStorage.setItem('mqtthost', $mqtthost.value);
    });

    // listners for buttons
    $clear_button.addEventListener('click', function() {
        PersistObjects.clearSelected();
    });

    $del_button.addEventListener('click', function() {
        PersistObjects.deleteSelected($scene.value);
        setTimeout(() => {
            PersistObjects.populateList($scene.value);
            reload();
        }, 500); // refresh after a while, so that delete messages are processed
    });

    $add_button.addEventListener('click', function() {
        if ($validate.value != 'valid') {
            alert("Please check validation errors.");
            return;
        }
        PersistObjects.addObject($output.value, $scene.value);
    });

    mqtt_reconnect.addEventListener('click', function() {
        mqttConnData = mqttHostAndPort($mqtthost.value);
        PersistObjects.mqttReconnect(mqttConnData);
        updateHost();
    });

    ////////////////////////////////
    // some defaults for testing
    $scene.value = "test";
    $mqtthost.value = "spatial.andrew.cmu.edu:8083";
    $arena_url.value = "https://spatial.andrew.cmu.edu:4443/";
    $select_schema.value = "arena-program.json";
    $select_schema.dispatchEvent(new Event('change'));
    await updateHost();
    PersistObjects.populateList($scene.value);
    
    var testobj = {
        "object_id": "2d817d1c-01e6-42d4-9460-e74d8c5be90b",
        "action": "create",
        "persist": true,
        "type": "program",
        "data": {
            "name": "npereira/arena-example",
            "filename": "arena_example.wasm",
            "filetype": "WA",
            "channels": [{ path: "/ch/wasm-demo", type: "pubsub", mode: "rw", params: { topic: "realm/s/wasm-demo" }}]
        }
    }

    setTimeout(() => {
        $output.value = JSON.stringify(testobj);
        jsoneditor.setValue(JSON.parse($output.value));

    }, 100);

    mqttConnData = mqttHostAndPort($mqtthost.value);
    PersistObjects.mqttReconnect(mqttConnData);
});