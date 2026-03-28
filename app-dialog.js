/**
 * 自訂置中對話框（取代原生 alert/confirm，不顯示瀏覽器網址列）
 */
(function (global) {
    'use strict';

    var overlay = null;
    var keyListener = null;

    function ensureDom() {
        if (overlay) {
            return;
        }
        var style = document.createElement('style');
        style.setAttribute('data-app-dialog', '1');
        style.textContent = [
            '#appDialogOverlay{position:fixed;inset:0;z-index:2147483646;',
            'background:rgba(15,23,42,.5);display:none;align-items:center;justify-content:center;',
            'padding:16px;box-sizing:border-box;font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif;}',
            '#appDialogOverlay.app-dialog-open{display:flex!important;}',
            '#appDialogPanel{background:#fff;border-radius:12px;box-shadow:0 25px 50px -12px rgba(0,0,0,.28);',
            'max-width:420px;width:100%;padding:24px 22px;box-sizing:border-box;',
            'animation:appDialogIn .2s ease-out;}',
            '@keyframes appDialogIn{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}',
            '#appDialogMessage{margin:0 0 20px;font-size:16px;line-height:1.55;color:#1e293b;',
            'white-space:pre-wrap;word-break:break-word;}',
            '#appDialogActions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;}',
            '#appDialogOverlay button{font:inherit;cursor:pointer;border-radius:8px;padding:10px 18px;',
            'border:none;min-width:88px;}',
            '#appDialogOk{background:#2C8EC4;color:#fff;}',
            '#appDialogOk:hover{background:#2474a0;}',
            '#appDialogCancel{background:#e2e8f0;color:#334155;}',
            '#appDialogCancel:hover{background:#cbd5e1;}'
        ].join('');
        document.head.appendChild(style);

        overlay = document.createElement('div');
        overlay.id = 'appDialogOverlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML =
            '<div id="appDialogPanel">' +
            '<p id="appDialogMessage"></p>' +
            '<div id="appDialogActions">' +
            '<button type="button" id="appDialogCancel">取消</button>' +
            '<button type="button" id="appDialogOk">確定</button>' +
            '</div></div>';

        overlay.addEventListener('click', function (ev) {
            if (ev.target !== overlay) {
                return;
            }
            var cb = overlay._backdropCallback;
            if (typeof cb === 'function') {
                cb();
            }
        });
        var panel = overlay.querySelector('#appDialogPanel');
        if (panel) {
            panel.addEventListener('click', function (e) {
                e.stopPropagation();
            });
        }
        document.body.appendChild(overlay);
    }

    function unbindKeys() {
        if (keyListener) {
            document.removeEventListener('keydown', keyListener, true);
            keyListener = null;
        }
    }

    function bindEscape(handler) {
        unbindKeys();
        keyListener = function (ev) {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                handler();
            }
        };
        document.addEventListener('keydown', keyListener, true);
    }

    function openOverlay() {
        overlay.classList.add('app-dialog-open');
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function closeOverlay() {
        overlay.classList.remove('app-dialog-open');
        overlay.style.display = 'none';
        document.body.style.overflow = '';
        overlay._backdropCallback = null;
        unbindKeys();
    }

    function appAlert(message) {
        ensureDom();
        var msgEl = overlay.querySelector('#appDialogMessage');
        var btnOk = overlay.querySelector('#appDialogOk');
        var btnCancel = overlay.querySelector('#appDialogCancel');
        return new Promise(function (resolve) {
            function done() {
                closeOverlay();
                btnOk.onclick = null;
                resolve();
            }
            msgEl.textContent = message == null ? '' : String(message);
            btnCancel.style.display = 'none';
            btnOk.textContent = '確定';
            overlay._backdropCallback = done;
            bindEscape(done);
            btnOk.onclick = function () {
                done();
            };
            openOverlay();
            setTimeout(function () {
                btnOk.focus();
            }, 0);
        });
    }

    function appConfirm(message) {
        ensureDom();
        var msgEl = overlay.querySelector('#appDialogMessage');
        var btnOk = overlay.querySelector('#appDialogOk');
        var btnCancel = overlay.querySelector('#appDialogCancel');
        return new Promise(function (resolve) {
            function finish(ok) {
                closeOverlay();
                btnOk.onclick = null;
                btnCancel.onclick = null;
                resolve(ok);
            }
            msgEl.textContent = message == null ? '' : String(message);
            btnCancel.style.display = '';
            btnOk.textContent = '確定';
            btnCancel.textContent = '取消';
            overlay._backdropCallback = function () {
                finish(false);
            };
            bindEscape(function () {
                finish(false);
            });
            btnOk.onclick = function () {
                finish(true);
            };
            btnCancel.onclick = function () {
                finish(false);
            };
            openOverlay();
            setTimeout(function () {
                btnOk.focus();
            }, 0);
        });
    }

    global.appAlert = appAlert;
    global.appConfirm = appConfirm;
})(typeof window !== 'undefined' ? window : this);
