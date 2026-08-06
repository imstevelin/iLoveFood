Java.perform(function () {
    function sendMidV(value) {
        if (!value) {
            return;
        }
        var match = String(value).match(/mid_v=([^&;]+)/);
        if (match && match[1]) {
            send({ type: "token_captured", mid_v: match[1] });
        }
    }

    // Capture both WebView overloads without logging the URL/token to disk.
    var WebView = Java.use("android.webkit.WebView");
    var loadUrlString = WebView.loadUrl.overload("java.lang.String");
    loadUrlString.implementation = function (url) {
        sendMidV(url);
        return loadUrlString.call(this, url);
    };

    var loadUrlHeaders = WebView.loadUrl.overload(
        "java.lang.String",
        "java.util.Map"
    );
    loadUrlHeaders.implementation = function (url, headers) {
        sendMidV(url);
        return loadUrlHeaders.call(this, url, headers);
    };

    var CookieManager = Java.use("android.webkit.CookieManager");
    var TextView = Java.use("android.widget.TextView");
    var setCookie = CookieManager.setCookie.overload(
        "java.lang.String",
        "java.lang.String"
    );
    setCookie.implementation = function (url, value) {
        sendMidV(value);
        return setCookie.call(this, url, value);
    };

    function dismissForcedUpdate(activity) {
        try {
            var resources = activity.getResources();
            var messageId = resources.getIdentifier(
                "lightbox_dialog_message",
                "id",
                activity.getPackageName()
            );
            var messageView = messageId ? activity.findViewById(messageId) : null;
            var message = messageView
                ? String(Java.cast(messageView, TextView).getText())
                : "";
            if (/更新|update/i.test(message)) {
                activity.finish();
                console.log("[*] 已關閉 7-ELEVEN 強制更新頁");
            }
        } catch (error) {
            console.log("[!] 檢查強制更新頁失敗: " + error);
        }
    }

    function isMessageLightboxIntent(intent) {
        try {
            var component = intent ? intent.getComponent() : null;
            var className = component ? String(component.getClassName()) : "";
            return /MessageLightboxActivity$/.test(className);
        } catch (error) {
            return false;
        }
    }

    // Once the current update Activity is closed, the main Activity immediately
    // tries to open it again. Block that explicit navigation at its source.
    var Activity = Java.use("android.app.Activity");
    var startActivityIntent = Activity.startActivity.overload(
        "android.content.Intent"
    );
    startActivityIntent.implementation = function (intent) {
        if (isMessageLightboxIntent(intent)) {
            return;
        }
        return startActivityIntent.call(this, intent);
    };

    var startActivityBundle = Activity.startActivity.overload(
        "android.content.Intent",
        "android.os.Bundle"
    );
    startActivityBundle.implementation = function (intent, bundle) {
        if (isMessageLightboxIntent(intent)) {
            return;
        }
        return startActivityBundle.call(this, intent, bundle);
    };

    var startForResult = Activity.startActivityForResult.overload(
        "android.content.Intent",
        "int"
    );
    startForResult.implementation = function (intent, requestCode) {
        if (isMessageLightboxIntent(intent)) {
            return;
        }
        return startForResult.call(this, intent, requestCode);
    };

    var startForResultBundle = Activity.startActivityForResult.overload(
        "android.content.Intent",
        "int",
        "android.os.Bundle"
    );
    startForResultBundle.implementation = function (intent, requestCode, bundle) {
        if (isMessageLightboxIntent(intent)) {
            return;
        }
        return startForResultBundle.call(this, intent, requestCode, bundle);
    };

    // The app uses a full Activity, not an AlertDialog, for its forced update.
    // Handle future instances and any one created before Frida attaches.
    try {
        var MessageLightboxActivity = Java.use(
            "ecowork.seven.activity.lightbox.MessageLightboxActivity"
        );
        var onResume = MessageLightboxActivity.onResume;
        onResume.implementation = function () {
            onResume.call(this);
            dismissForcedUpdate(this);
        };

        Java.choose(
            "ecowork.seven.activity.lightbox.MessageLightboxActivity",
            {
                onMatch: function (instance) {
                    var retained = Java.retain(instance);
                    Java.scheduleOnMainThread(function () {
                        dismissForcedUpdate(retained);
                    });
                },
                onComplete: function () {},
            }
        );
    } catch (error) {
        console.log("[!] 無法安裝更新頁防護: " + error);
    }

    // Keep the older dialog protection for banners implemented as Dialog.
    var Dialog = Java.use("android.app.Dialog");
    var dialogShow = Dialog.show;
    dialogShow.implementation = function () {
        var className = String(this.getClass().getName());
        if (/Update|Version|Upgrade|Exit|Quit/i.test(className)) {
            console.log("[*] 已屏蔽干擾彈窗: " + className);
            return;
        }
        return dialogShow.call(this);
    };
});
