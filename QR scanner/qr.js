const video = document.getElementById("camera");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const resultElement = document.getElementById("result");
const loadingElement = document.getElementById("loading");
const snapshotContainer = document.getElementById("snapshotContainer");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

const scanIndicator = document.createElement("div");
const SCAN_INTERVAL = 250;
const SCAN_WIDTH = 400;
const CAMERA_RESOLUTION = {
    width: { ideal: 400, max: 1280 },
    height: { ideal: 300, max: 720 }
};

const QR_OPTIONS = {
    inversionAttempts: "attemptBoth",
    canOverwriteImage: false,
    maxScansPerImage: 15
};

let stream = null;
let animationId = null;
let isScanning = false;
let lastScanTime = 0;

function initScanner() {
    scanIndicator.id = "scanIndicator";
    scanIndicator.style.cssText = `
        width: 30px;
        height: 30px;
        border: 3px solid rgba(0,0,0,0.1);
        border-top: 3px solid #3498db;
        border-radius: 50%;
        display: none;
        margin: 15px auto;
        transition: opacity 0.3s;
    `;
    document.body.appendChild(scanIndicator);

    startBtn.addEventListener('click', startScanner);
    stopBtn.addEventListener('click', stopScanner);
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        startBtn.disabled = true;
        resultElement.innerHTML = `
            <span style="color:red">
                Ձեր բրաուզերը չի աջակցում կամերայի հասանելիությունը
            </span>
        `;
    }
}

async function startScanner() {
    if (isScanning) return;

    resetUI();
    showLoading(true);

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "environment",
                ...CAMERA_RESOLUTION
            },
            audio: false
        });

        video.srcObject = stream;
        isScanning = true;
        showLoading(false);
        
        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                resolve();
            };
        });

        startScanning();
        updateScanIndicator();

    } catch (error) {
        handleCameraError(error);
    }
}

function startScanning() {
    function scanLoop() {
        if (!isScanning) return;
        
        const now = Date.now();
        if (now - lastScanTime >= SCAN_INTERVAL) {
            lastScanTime = now;
            processFrame();
        }
        
        animationId = requestAnimationFrame(scanLoop);
    }
    
    scanLoop();
}

function processFrame() {
    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

    const scanHeight = Math.round(SCAN_WIDTH * video.videoHeight / video.videoWidth);
    ctx.drawImage(video, 0, 0, SCAN_WIDTH, scanHeight);
    
    try {
        const imageData = ctx.getImageData(0, 0, SCAN_WIDTH, scanHeight);
        const code = jsQR(imageData.data, SCAN_WIDTH, scanHeight, QR_OPTIONS);
        
        if (code) {
            processDetectedCode(code);
        } else {
            updateScanStatus("🔍 Որոնում եմ QR կոդ...");
        }
    } catch (error) {
        console.error("Վերլուծության սխալ:", error);
    }
}

/**
 * @param {object} code
 */
function processDetectedCode(code) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const validation = validateContent(code.data);
    if (!validation.valid) {
        updateScanStatus(`⚠️ ${validation.message}`);
        return;
    }
    
    const qrImage = extractQRImage(code);
    displayResult(qrImage, code.data, validation.type);
    
    stopScanner();
}


function validateContent(data) {
    try {
        if (/^https?:\/\//i.test(data)) {
            new URL(data);
            return { valid: true, type: 'url', message: 'URL հղում' };
        }
        if (/^[a-z0-9]+$/i.test(data)) {
            return { valid: true, type: 'text', message: 'Տեքստ' };
        }
        return { valid: false, message: 'Անհայտ ֆորմատ' };
    } catch {
        return { valid: false, message: 'Անվավեր URL' };
    }
}


function extractQRImage(code) {
    const padding = 15;
    const corners = [
        code.location.topLeftCorner,
        code.location.topRightCorner,
        code.location.bottomRightCorner,
        code.location.bottomLeftCorner
    ];
    
    const x = Math.max(0, Math.min(...corners.map(c => c.x)) - padding);
    const y = Math.max(0, Math.min(...corners.map(c => c.y)) - padding);
    const right = Math.min(canvas.width, Math.max(...corners.map(c => c.x)) + padding);
    const bottom = Math.min(canvas.height, Math.max(...corners.map(c => c.y)) + padding);
    
    const width = right - x;
    const height = bottom - y;
    
    const qrCanvas = document.createElement("canvas");
    qrCanvas.width = width;
    qrCanvas.height = height;
    
    qrCanvas.getContext("2d").putImageData(
        ctx.getImageData(x, y, width, height), 
        0, 0
    );
    
    return {
        url: qrCanvas.toDataURL("image/png"),
        width,
        height,
        x,
        y
    };
}



function displayResult(qrImage, data, type) {
    const threatInfo = checkForThreats(data);
    const isUrl = type === 'url';
    const isEmail = type === 'email';
    const isPhone = type === 'phone';
    
    let resultHTML = `
        <div class="result-container" style="max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background: #f9f9f9;">
            <h3 style="color: #28a745; text-align: center; margin-bottom: 20px;">✅ QR կոդ հայտնաբերված է</h3>
            <div class="qr-image-container" style="text-align: center; margin-bottom: 20px;">
                <img src="${qrImage.url}" alt="QR կոդ" style="max-width: 200px; border: 2px solid #28a745; border-radius: 8px; margin-bottom: 15px;">
                <div class="qr-meta">
                    <p style="margin: 10px 0;"><strong>Տեսակ:</strong> ${
                        type === 'url' ? '🔗 Հղում' : 
                        type === 'email' ? '📧 Email' :
                        type === 'phone' ? '📞 Телефон' :
                        '📝 Տեքստ'
                    }</p>
                    ${threatInfo.isDangerous ? `
                        <div style="color: red; font-weight: bold; margin: 10px 0;">
                            ⚠️ ${threatInfo.warning}
                        </div>
                        <div style="margin-bottom: 10px;">
                            ${threatInfo.description}
                        </div>
                    ` : `
                        <div style="color: green; margin: 10px 0;">
                            ✓ Անվտանգ
                        </div>
                    `}
                    <div class="qr-data" style="word-break: break-all; background: white; padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid #ddd; font-family: monospace; font-size: 14px; max-height: 150px; overflow-y: auto;">${escapeHTML(data)}</div>
                </div>
            </div>
            <div class="actions" style="text-align: center;">
    `;

    if (isUrl) {
        resultHTML += `
            <button onclick="openLink('${escapeHTML(data)}', ${threatInfo.isDangerous})" 
                    style="background: ${threatInfo.isDangerous ? '#dc3545' : '#007bff'}; color: white; padding: 12px 24px; border: none; border-radius: 6px; margin: 5px; cursor: pointer; font-size: 14px;">
                ${threatInfo.isDangerous ? '⚠️ Բացել (անվտանգ չէ)' : '🔗 Բացել հղումը'}
            </button>
        `;
    }
    
    if (isEmail) {
        resultHTML += `
            <button onclick="sendEmail('${escapeHTML(data)}')" 
                    style="background: #17a2b8; color: white; padding: 12px 24px; border: none; border-radius: 6px; margin: 5px; cursor: pointer; font-size: 14px;">
                📧 Գրել նամակ
            </button>
        `;
    }
    
    if (isPhone) {
        resultHTML += `
            <button onclick="callNumber('${escapeHTML(data)}')" 
                    style="background: #28a745; color: white; padding: 12px 24px; border: none; border-radius: 6px; margin: 5px; cursor: pointer; font-size: 14px;">
                📞 Զանգահարել
            </button>
        `;
    }
    
    resultHTML += `
                <button onclick="copyToClipboard('${escapeHTML(data)}')" 
                        style="background: #6c757d; color: white; padding: 12px 24px; border: none; border-radius: 6px; margin: 5px; cursor: pointer; font-size: 14px;">
                    📋 Պատճենել
                </button>
                <button onclick="startScanner()" 
                        style="background: #ffc107; color: black; padding: 12px 24px; border: none; border-radius: 6px; margin: 5px; cursor: pointer; font-size: 14px;">
                    🔍 Սկանավորել կրկին
                </button>
            </div>
        </div>
    `;
    
    snapshotContainer.innerHTML = resultHTML;
}

function checkForThreats(data) {
    if (!data) return {
        isDangerous: false,
        warning: '',
        description: ''
    };
    
    if (data.startsWith('http')) {
        try {
            const url = new URL(data);
            
            const suspiciousDomains = [
                'bit.ly', 'tinyurl.com', 'shorte.st', 'cutt.ly',
                /[a-z0-9]{12,}\.(com|net|org)/i,
                'login-form.com', 'account-verify.com'
            ];
            
            for (const domain of suspiciousDomains) {
                if (typeof domain === 'string' && url.hostname.includes(domain)) {
                    return {
                        isDangerous: true,
                        warning: 'Կասկածելի հղում',
                        description: 'Այս հղումը կարող է ուղղորդել դեպի ֆիշինգ կամ վնասակար կայք:'
                    };
                }
                if (domain instanceof RegExp && domain.test(url.hostname)) {
                    return {
                        isDangerous: true,
                        warning: 'Կասկածելի դոմեն',
                        description: 'Դոմենի անունը թվում է պատահական և կարող է վտանգավոր լինել:'
                    };
                }
            }
            
            if (url.protocol === 'http:') {
                return {
                    isDangerous: true,
                    warning: 'Անապահով կապ',
                    description: 'Այս կայքը չի օգտագործում HTTPS և կարող է խոցելի լինել:'
                };
            }
            

            if (/^https?:\/\/(\d{1,3}\.){3}\d{1,3}/.test(data)) {
                return {
                    isDangerous: true,
                    warning: 'IP հասցե',
                    description: 'Հղումը ուղղակիորեն օգտագործում է IP հասցե, ինչը կարող է լինել կասկածելի:'
                };
            }
        } catch (e) {
            console.error('URL parse error:', e);
        }
    }
    

    const maliciousPatterns = [
        /(eval\(|system\()/i,
        /(\.exe|\.bat|\.sh|\.js)$/i,
        /(javascript:|data:text\/html)/i
    ];
    
    for (const pattern of maliciousPatterns) {
        if (pattern.test(data)) {
            return {
                isDangerous: true,
                warning: 'Վնասակար կոդ',
                description: 'QR կոդը պարունակում է կոդ, որը կարող է վնասել ձեր սարքը:'
            };
        }
    }
    
    if (/^(javascript:|data:text\/html)/i.test(data)) {
        return { isDangerous: true, warning: 'Վտանգավոր հղում' };
    }
    
    
    if (/(password|login|account|verify|bank|paypal)/i.test(data) && 
        !/^https?:\/\/(www\.)?(paypal|bank\.com)/i.test(data)) {
        return {
            isDangerous: true,
            warning: 'Հնարավոր ֆիշինգ',
            description: 'QR կոդը պարունակում է զգայլիկ տվյալներ և կարող է լինել փորձ գողանալ ձեր տվյալները:'
        };
    }
    
    return {
        isDangerous: false,
        warning: '',
        description: ''
    };
}


function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag]));
}

function openLink(url, isDangerous) {
    if (isDangerous) {
        if (!confirm('⚠️ Ուշադրություն: Այս հղումը կարող է վտանգավոր լինել:\n\nՑանկանու՞մ եք բացել այն:')) {
            return;
        }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
}

function sendEmail(email) {
    window.location.href = `mailto:${email}`;
}

function callNumber(phone) {
    window.location.href = `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => {
            const notification = document.createElement('div');
            notification.textContent = 'Պատճենված է!';
            notification.style.position = 'fixed';
            notification.style.bottom = '20px';
            notification.style.right = '20px';
            notification.style.backgroundColor = '#28a745';
            notification.style.color = 'white';
            notification.style.padding = '10px 20px';
            notification.style.borderRadius = '5px';
            notification.style.zIndex = '1000';
            document.body.appendChild(notification);
            
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 2000);
        })
        .catch(err => {
            console.error('Copy failed:', err);
            alert('Չհաջողվեց պատճենել');
        });
}




function resetUI() {
    resultElement.innerHTML = "";
    snapshotContainer.innerHTML = "";
    video.style.display = "block";
    canvas.style.display = "block";
    startBtn.disabled = true;
    stopBtn.disabled = false;
}


function showLoading(show) {
    loadingElement.style.display = show ? "block" : "none";
    scanIndicator.style.display = show ? "none" : "block";
}


function updateScanStatus(message) {
    resultElement.innerHTML = message;
}

function updateScanIndicator() {
    if (!isScanning) {
        scanIndicator.style.display = "none";
        return;
    }
    scanIndicator.style.transform = `rotate(${Date.now() / 20 % 360}deg)`;
    requestAnimationFrame(updateScanIndicator);
}

function stopScanner() {
    if (!isScanning) return;
    
    isScanning = false;
    cancelAnimationFrame(animationId);
    
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    
    video.style.display = "none";
    canvas.style.display = "none";
    startBtn.disabled = false;
    stopBtn.disabled = true;
    scanIndicator.style.display = "none";
}


function handleCameraError(error) {
    console.error("Կամերայի սխալ:", error);
    
    let message = "Հնարավոր չէ մուտք գործել կամերա";
    if (error.name === "NotAllowedError") {
        message = "Կամերայի օգտագործումը արգելված է: Խնդրում ենք թույլատրել բրաուզերի կարգավորումներում";
    } else if (error.name === "NotFoundError") {
        message = "Կամերա չի գտնվել";
    }
    
    resultElement.innerHTML = `<span style="color:red">${message}</span>`;
    showLoading(false);
    startBtn.disabled = false;
}

document.addEventListener('DOMContentLoaded', initScanner);

window.addEventListener('resize', () => {
    if (isScanning && video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }
});