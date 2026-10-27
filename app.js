import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// --- State Variables ---
let editor = null; 
let currentMesh = new THREE.Group(); 
let baseSize = new THREE.Vector3(); 
let boxHelper = null;
let printVolumeBox = null;
let worker = null;
let isUpdatingFromUI = false;
let currentUnit = 'mm';
let saveTimeout = null;
let toastTimeout = null;
let printX = 256, printY = 256, printZ = 256;
let activeMobileTab = 'preview'; // Default view for mobile

// --- Toast Feedback Helper ---
function showToast(msg, type = 'normal', duration = 3000) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `active ${type}`;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.className = '';
    }, duration);
}

// --- DOM Elements ---
const wrapper = document.getElementById('canvas-wrapper');
const consoleEl = document.getElementById('console-container');
const consoleWrapper = document.getElementById('console-wrapper');
const consoleHeader = document.getElementById('console-header');
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');

function showLoading(msg = 'Compiling Model...') {
    if (loadingText) loadingText.innerText = msg;
    if (loadingEl) loadingEl.style.display = 'flex';
}

function hideLoading() {
    if (loadingEl) loadingEl.style.display = 'none';
}

const colorPicker = document.getElementById('model-color');
const dimX = document.getElementById('dim-x');
const dimY = document.getElementById('dim-y');
const dimZ = document.getElementById('dim-z');
const posX = document.getElementById('pos-x');
const posY = document.getElementById('pos-y');
const posZ = document.getElementById('pos-z');
const rotX = document.getElementById('rot-x');
const rotY = document.getElementById('rot-y');
const rotZ = document.getElementById('rot-z');
const panelTranslate = document.getElementById('controls-translate');
const panelRotate = document.getElementById('controls-rotate');
const panelScale = document.getElementById('controls-scale');
const unitSelectRow = document.getElementById('unit-select-row');
const unitSelect = document.getElementById('unit-select');
const uniformScale = document.getElementById('uniform-scale');
const gridSizeInput = document.getElementById('grid-size');
const toggleGridNumbers = document.getElementById('toggle-grid-numbers');
const togglePrintVolume = document.getElementById('toggle-print-volume');
const printerProfile = document.getElementById('printer-profile');
const zoomSlider = document.getElementById('zoom-slider');
const saveStatus = document.getElementById('save-status');

const leftPane = document.getElementById('left-pane');
const previewContainer = document.getElementById('preview-container');
const tabCode = document.getElementById('tab-code');
const tabPreview = document.getElementById('tab-preview');
const rightPanel = document.getElementById('right-panel');
const sheetBackdrop = document.getElementById('sheet-backdrop');
const btnMobileSheet = document.getElementById('btn-mobile-sheet');
const btnCloseSheet = document.getElementById('btn-close-sheet');
const btnMobileCenter = document.getElementById('btn-mobile-center');
const btnMobileExport = document.getElementById('btn-mobile-export');
const headerBtnExport = document.getElementById('header-btn-export');
const btnExportStl = document.getElementById('btn-export-stl');
const btnPaste = document.getElementById('btn-paste');
const btnCopy = document.getElementById('btn-copy');
const btnOpenFile = document.getElementById('btn-open-file');
const fileInput = document.getElementById('file-input');
const btnRender = document.getElementById('btn-render');
const pasteModal = document.getElementById('paste-modal');
const pasteInput = document.getElementById('paste-modal-input');
const btnPasteConfirm = document.getElementById('btn-paste-confirm');
const btnPasteCancel = document.getElementById('btn-paste-cancel');


// --- 1. Three.js Scene Setup ---
const scene = new THREE.Scene();

const clientW = wrapper ? (wrapper.clientWidth || window.innerWidth) : window.innerWidth;
const clientH = wrapper ? (wrapper.clientHeight || window.innerHeight) : window.innerHeight;

let cameraPersp = new THREE.PerspectiveCamera(45, clientW / clientH, 0.1, 3000);
let cameraOrtho = new THREE.OrthographicCamera(clientW / -4, clientW / 4, clientH / 4, clientH / -4, 0.1, 3000);
let camera = cameraPersp;
camera.position.set(220, 200, 220);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(clientW, clientH);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
renderer.domElement.style.touchAction = 'none'; // Critical for smooth touch navigation
if (wrapper) wrapper.appendChild(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.maxPolarAngle = Math.PI / 2 + 0.02; 
orbit.zoomSpeed = 1.2; 
orbit.minDistance = 25;
orbit.maxDistance = 1400;
orbit.target.set(0, 20, 0);

// Camera & Zoom Logic
const MIN_DIST = 25;
const MAX_DIST = 1400;
let isDraggingZoomSlider = false;

if (zoomSlider) {
    zoomSlider.addEventListener('mousedown', () => { isDraggingZoomSlider = true; });
    zoomSlider.addEventListener('touchstart', () => { isDraggingZoomSlider = true; }, { passive: true });
    window.addEventListener('mouseup', () => { isDraggingZoomSlider = false; });
    window.addEventListener('touchend', () => { isDraggingZoomSlider = false; });
}

function syncZoomSlider() {
    if (isDraggingZoomSlider || !zoomSlider) return;
    let dist;
    if (camera.isOrthographicCamera) {
        dist = 220 / Math.max(camera.zoom, 0.01);
    } else {
        dist = camera.position.distanceTo(orbit.target);
    }
    dist = Math.min(Math.max(dist, MIN_DIST), MAX_DIST);
    const val = 100 - 100 * (Math.log(dist / MIN_DIST) / Math.log(MAX_DIST / MIN_DIST));
    zoomSlider.value = Math.min(Math.max(val, 0), 100);
}
orbit.addEventListener('change', syncZoomSlider);

function setZoomFromSlider(sliderVal) {
    const clampedVal = Math.min(Math.max(parseFloat(sliderVal), 0), 100);
    const targetDistance = MIN_DIST * Math.pow(MAX_DIST / MIN_DIST, (100 - clampedVal) / 100);
    
    const direction = new THREE.Vector3().subVectors(camera.position, orbit.target).normalize();
    if (direction.lengthSq() === 0) direction.set(1, 0.85, 1).normalize();
    camera.position.copy(orbit.target).add(direction.multiplyScalar(targetDistance));
    
    if (camera.isOrthographicCamera) {
        camera.zoom = 220 / targetDistance;
        camera.updateProjectionMatrix();
    }
    orbit.update();
}

if (zoomSlider) {
    zoomSlider.addEventListener('input', (e) => setZoomFromSlider(e.target.value));
}

document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    if (!zoomSlider) return;
    const currentVal = parseFloat(zoomSlider.value);
    const newVal = Math.min(currentVal + 12, 100);
    zoomSlider.value = newVal;
    setZoomFromSlider(newVal);
});

document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    if (!zoomSlider) return;
    const currentVal = parseFloat(zoomSlider.value);
    const newVal = Math.max(currentVal - 12, 0);
    zoomSlider.value = newVal;
    setZoomFromSlider(newVal);
});

document.getElementById('btn-cam-lens')?.addEventListener('click', () => {
    const currentPos = camera.position.clone();
    const currentTarget = orbit.target.clone();
    const dist = currentPos.distanceTo(currentTarget);
    
    if (camera.isPerspectiveCamera) {
        camera = cameraOrtho;
        camera.zoom = 220 / Math.max(dist, 10);
    } else {
        camera = cameraPersp;
    }
    
    camera.position.copy(currentPos);
    camera.updateProjectionMatrix();
    
    orbit.object = camera;
    orbit.target.copy(currentTarget);
    orbit.update();
    
    transformControl.camera = camera;
    const lensBtn = document.getElementById('btn-cam-lens');
    if (lensBtn) lensBtn.style.color = camera.isOrthographicCamera ? '#3b82f6' : '#9ca3af';
    syncZoomSlider();
});

function setCameraPreset(x, y, z, tx, ty, tz, btnId) {
    camera.position.set(x, y, z);
    orbit.target.set(tx, ty, tz);
    if (camera.isOrthographicCamera) {
        const dist = camera.position.distanceTo(orbit.target);
        camera.zoom = 220 / dist;
        camera.updateProjectionMatrix();
    }
    orbit.update();
    syncZoomSlider();
    document.querySelectorAll('#camera-presets button:not(#btn-cam-lens)').forEach(b => b.classList.remove('active'));
    if (btnId) document.getElementById(btnId)?.classList.add('active');
}

function fitCameraToObject() {
    const targetBox = new THREE.Box3();
    if (currentMesh && currentMesh.geometry) {
        targetBox.setFromObject(currentMesh);
    } else {
        targetBox.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(printX, 20, printY));
    }
    
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    targetBox.getSize(size);
    targetBox.getCenter(center);
    
    const maxDim = Math.max(size.x, size.y, size.z, 60);
    const fov = cameraPersp.fov * (Math.PI / 180);
    let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.8;
    cameraDistance = Math.max(cameraDistance, 140);
    
    orbit.target.copy(center);
    
    const dir = new THREE.Vector3(1, 0.85, 1).normalize();
    camera.position.copy(center).add(dir.multiplyScalar(cameraDistance));
    
    if (camera.isOrthographicCamera) {
        camera.zoom = 220 / cameraDistance;
        camera.updateProjectionMatrix();
    }
    orbit.update();
    syncZoomSlider();
    document.querySelectorAll('#camera-presets button:not(#btn-cam-lens)').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-cam-fit')?.classList.add('active');
}

document.getElementById('btn-cam-fit')?.addEventListener('click', fitCameraToObject);
document.getElementById('btn-cam-top')?.addEventListener('click', () => setCameraPreset(0, 360, 0, 0, 0, 0, 'btn-cam-top'));
document.getElementById('btn-cam-front')?.addEventListener('click', () => setCameraPreset(0, 25, 360, 0, 25, 0, 'btn-cam-front'));
document.getElementById('btn-cam-iso')?.addEventListener('click', () => setCameraPreset(220, 200, 220, 0, 25, 0, 'btn-cam-iso'));


// --- 2. Interactive Gizmos ---
const transformControl = new TransformControls(camera, renderer.domElement);
transformControl.size = window.innerWidth <= 768 ? 0.85 : 0.6; 
transformControl.space = 'local'; 

transformControl.traverse((child) => {
    if (child.isMesh && child.material) {
        const m = child.material;
        const hex = m.color.getHex();
        if (hex === 0xff0000) m.color.setHex(0xf87171); 
        if (hex === 0x00ff00) m.color.setHex(0x34d399); 
        if (hex === 0x0000ff) m.color.setHex(0x60a5fa); 
        if (hex === 0xffff00) m.color.setHex(0xfbbf24); 
        if (hex === 0x00ffff) m.color.setHex(0x2dd4bf); 
        if (hex === 0xff00ff) m.color.setHex(0xd946ef); 
        m.transparent = true;
        m.opacity = 0.9;
    }
});

transformControl.addEventListener('dragging-changed', (event) => orbit.enabled = !event.value);
transformControl.addEventListener('change', updateUIFromGizmo);
scene.add(transformControl);

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

if (wrapper) {
    wrapper.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.tagName === 'BUTTON' || event.target.tagName === 'INPUT') return;
        const rect = wrapper.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(currentMesh, true);
        if (intersects.length > 0) transformControl.attach(currentMesh);
        else if (!transformControl.dragging) transformControl.detach();
    });
}


// --- 3. Lighting & Dynamic Build Plate ---
scene.add(new THREE.AmbientLight(0xaaaaaa)); 
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8); 
hemiLight.position.set(0, 200, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(100, 200, 50); 
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 400;
dirLight.shadow.camera.left = -200;
dirLight.shadow.camera.right = 200;
dirLight.shadow.camera.top = 200;
dirLight.shadow.camera.bottom = -200;
dirLight.shadow.bias = -0.0005;
dirLight.shadow.radius = 8; 
scene.add(dirLight);

let bedMesh;

function generateGridTexture(bedX, bedY, visualSpacingMM, showNumbers) {
    const canvas = document.createElement('canvas');
    const maxDim = Math.max(bedX, bedY);
    const res = 2048; 
    canvas.width = res * (bedX / maxDim);
    canvas.height = res * (bedY / maxDim);
    const ctx = canvas.getContext('2d');
    
    const scale = res / maxDim;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    ctx.fillStyle = '#262626'; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.strokeStyle = '#555555';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(centerX, 0); ctx.lineTo(centerX, canvas.height);
    ctx.moveTo(0, centerY); ctx.lineTo(canvas.width, centerY);
    ctx.stroke();
    
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    for(let i = 1; i <= Math.floor((bedX / 2) / visualSpacingMM); i++) {
        let offset = i * visualSpacingMM * scale;
        ctx.moveTo(centerX + offset, 0); ctx.lineTo(centerX + offset, canvas.height);
        ctx.moveTo(centerX - offset, 0); ctx.lineTo(centerX - offset, canvas.height);
    }
    for(let i = 1; i <= Math.floor((bedY / 2) / visualSpacingMM); i++) {
        let offset = i * visualSpacingMM * scale;
        ctx.moveTo(0, centerY + offset); ctx.lineTo(canvas.width, centerY + offset);
        ctx.moveTo(0, centerY - offset); ctx.lineTo(canvas.width, centerY - offset);
    }
    ctx.stroke();

    if (showNumbers) {
        ctx.font = '22px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#777777';
        ctx.fillText("0", centerX - 15, centerY + 15);
        
        let stepMultiplier = 1;
        while ((visualSpacingMM * stepMultiplier * scale) < 60) stepMultiplier++;
        const unitMultiplier = unitSelect && unitSelect.value === 'in' ? (1 / 25.4) : 1;

        for(let i = 1; i <= Math.floor((bedX / 2) / visualSpacingMM); i++) {
            if (i % stepMultiplier === 0) {
                let physicalPosMM = i * visualSpacingMM;
                let displayVal = parseFloat((physicalPosMM * unitMultiplier).toFixed(2));
                let offset = physicalPosMM * scale;
                ctx.fillText(displayVal.toString(), centerX + offset, centerY + 20);
                ctx.fillText((-displayVal).toString(), centerX - offset, centerY + 20);
            }
        }
        for(let i = 1; i <= Math.floor((bedY / 2) / visualSpacingMM); i++) {
            if (i % stepMultiplier === 0) {
                let physicalPosMM = i * visualSpacingMM;
                let displayVal = parseFloat((physicalPosMM * unitMultiplier).toFixed(2));
                let offset = physicalPosMM * scale;
                ctx.fillText(displayVal.toString(), centerX - 25, centerY + offset);
                ctx.fillText((-displayVal).toString(), centerX - 25, centerY - offset);
            }
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return texture;
}

function updateBedGrid() {
    let rawInput = gridSizeInput ? parseFloat(gridSizeInput.value) : 10;
    if (isNaN(rawInput) || rawInput <= 0) rawInput = 10;
    
    const visualSpacingMM = unitSelect && unitSelect.value === 'in' ? rawInput * 25.4 : rawInput;
    const showNumbers = toggleGridNumbers ? toggleGridNumbers.checked : true;
    const texture = generateGridTexture(printX, printY, visualSpacingMM, showNumbers);
    
    if (bedMesh) scene.remove(bedMesh);
    
    bedMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(printX, printY),
        new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1, map: texture })
    );
    bedMesh.rotation.x = -Math.PI / 2;
    bedMesh.receiveShadow = true;
    scene.add(bedMesh);
    
    if (togglePrintVolume && togglePrintVolume.checked) drawPrintVolume();
}

function drawPrintVolume() {
    if (printVolumeBox) scene.remove(printVolumeBox);
    const volumeEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(printX, printZ, printY));
    printVolumeBox = new THREE.LineSegments(volumeEdges, new THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.4 }));
    printVolumeBox.position.y = printZ / 2;
    scene.add(printVolumeBox);
}

if (printerProfile) {
    printerProfile.addEventListener('change', (e) => {
        const dims = e.target.value.split(',').map(Number);
        printX = dims[0]; printY = dims[1]; printZ = dims[2];
        updateBedGrid();
    });
}
updateBedGrid();

if (gridSizeInput) gridSizeInput.addEventListener('change', updateBedGrid);
if (toggleGridNumbers) toggleGridNumbers.addEventListener('change', updateBedGrid);

scene.add(currentMesh);

function animate() {
    requestAnimationFrame(animate);
    orbit.update(); 
    renderer.render(scene, camera);
}
animate();


// --- 4. Touch-Friendly Scrubbing Labels (Pointer Events) ---
document.querySelectorAll('.scrub-label').forEach(label => {
    let startX = 0;
    let startVal = 0;
    const input = document.getElementById(label.dataset.target);
    if (!input) return;
    
    label.addEventListener('pointerdown', (e) => {
        startX = e.clientX;
        startVal = parseFloat(input.value) || 0;
        try { label.setPointerCapture(e.pointerId); } catch(err) {}
        
        const onPointerMove = (eMove) => {
            const deltaX = eMove.clientX - startX;
            const step = parseFloat(input.step) || 1;
            const change = Math.round((deltaX * 0.5) / step) * step; 
            
            let newVal = startVal + change;
            if (input.min && newVal < parseFloat(input.min)) newVal = parseFloat(input.min);
            
            input.value = newVal.toFixed(step < 1 ? 2 : 0);
            input.dispatchEvent(new Event('change'));
        };
        
        const onPointerUp = (eUp) => {
            label.removeEventListener('pointermove', onPointerMove);
            label.removeEventListener('pointerup', onPointerUp);
            label.removeEventListener('pointercancel', onPointerUp);
            try { label.releasePointerCapture(e.pointerId); } catch(err) {}
            document.body.style.cursor = 'default';
        };
        
        document.body.style.cursor = 'ew-resize';
        label.addEventListener('pointermove', onPointerMove);
        label.addEventListener('pointerup', onPointerUp);
        label.addEventListener('pointercancel', onPointerUp);
        e.preventDefault();
    });
});


// --- 5. Responsive Layout, Resizer & Mobile Tabs ---
function updateCanvasSize() {
    if (!wrapper || wrapper.clientWidth === 0 || wrapper.clientHeight === 0) return;
    const width = wrapper.clientWidth;
    const height = wrapper.clientHeight;
    
    if (camera.isPerspectiveCamera) {
        camera.aspect = width / height;
    } else {
        camera.left = width / -4;
        camera.right = width / 4;
        camera.top = height / 4;
        camera.bottom = height / -4;
    }
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

const resizeObserver = new ResizeObserver(() => {
    updateCanvasSize();
    if (editor) editor.layout();
});
if (wrapper) resizeObserver.observe(wrapper);
const editorCont = document.getElementById('editor-container');
if (editorCont) resizeObserver.observe(editorCont);

// Desktop Resizer
const resizer = document.getElementById('resizer');
let isResizing = false;

if (resizer) {
    resizer.addEventListener('mousedown', () => {
        isResizing = true;
        resizer.classList.add('active');
        document.body.style.cursor = 'col-resize';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing || !leftPane) return;
        let newWidth = e.clientX;
        if (newWidth < 200) newWidth = 200;
        if (newWidth > window.innerWidth - 320) newWidth = window.innerWidth - 320;
        leftPane.style.width = newWidth + 'px';
        leftPane.style.flex = 'none';
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('active');
            document.body.style.cursor = 'default';
        }
    });
}

// Desktop Editor Collapse Toggle
document.getElementById('btn-toggle-editor')?.addEventListener('click', () => {
    if (!leftPane) return;
    leftPane.classList.toggle('collapsed');
    if (leftPane.classList.contains('collapsed')) {
        leftPane.style.display = 'none';
        if (resizer) resizer.style.display = 'none';
    } else {
        leftPane.style.display = 'flex';
        if (resizer) resizer.style.display = 'flex';
    }
});

// Mobile Bottom Sheet controls
function openBottomSheet() {
    if (rightPanel) rightPanel.classList.add('sheet-open');
    if (sheetBackdrop) sheetBackdrop.classList.add('active');
}

function closeBottomSheet() {
    if (rightPanel) rightPanel.classList.remove('sheet-open');
    if (sheetBackdrop) sheetBackdrop.classList.remove('active');
}

if (btnMobileSheet) btnMobileSheet.addEventListener('click', openBottomSheet);
if (btnCloseSheet) btnCloseSheet.addEventListener('click', closeBottomSheet);
if (sheetBackdrop) sheetBackdrop.addEventListener('click', closeBottomSheet);

// Mobile Tabs Switching
function switchMobileTab(tab) {
    activeMobileTab = tab;
    const isMobile = window.innerWidth <= 768;
    if (!isMobile) return;
    
    if (tab === 'code') {
        if (tabCode) tabCode.classList.add('active');
        if (tabPreview) tabPreview.classList.remove('active');
        if (leftPane) leftPane.classList.remove('mobile-hidden');
        if (previewContainer) previewContainer.classList.add('mobile-hidden');
        closeBottomSheet();
        setTimeout(() => { if (editor) editor.layout(); }, 60);
    } else {
        if (tabCode) tabCode.classList.remove('active');
        if (tabPreview) tabPreview.classList.add('active');
        if (leftPane) leftPane.classList.add('mobile-hidden');
        if (previewContainer) previewContainer.classList.remove('mobile-hidden');
        setTimeout(() => { updateCanvasSize(); }, 60);
    }
}

if (tabCode) tabCode.addEventListener('click', () => switchMobileTab('code'));
if (tabPreview) tabPreview.addEventListener('click', () => switchMobileTab('preview'));

function handleResponsiveLayout() {
    const isMobile = window.innerWidth <= 768;
    transformControl.size = isMobile ? 0.85 : 0.6;
    
    if (isMobile) {
        switchMobileTab(activeMobileTab);
    } else {
        if (leftPane) leftPane.classList.remove('mobile-hidden');
        if (previewContainer) previewContainer.classList.remove('mobile-hidden');
        closeBottomSheet();
    }
    updateCanvasSize();
    if (editor) editor.layout();
}

window.addEventListener('resize', handleResponsiveLayout);
window.addEventListener('orientationchange', () => setTimeout(handleResponsiveLayout, 100));

// Collapsible Console
if (consoleHeader && consoleWrapper) {
    consoleHeader.addEventListener('click', () => {
        consoleWrapper.classList.toggle('collapsed');
    });
}

// Drag & Drop Local File Loading
const dragOverlay = document.getElementById('drag-overlay');
if (dragOverlay) {
    window.addEventListener('dragover', (e) => { e.preventDefault(); dragOverlay.classList.add('active'); });
    window.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) dragOverlay.classList.remove('active'); });
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        dragOverlay.classList.remove('active');
        if (e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            const reader = new FileReader();
            reader.onload = (event) => applyNewCode(event.target.result);
            reader.readAsText(file);
        }
    });
}


// --- 6. AI Code Pasting, File Loading & Exporters ---
function applyNewCode(code) {
    if (editor) {
        editor.setValue(code);
    } else {
        localStorage.setItem('openscad-studio-saved-code', code);
    }
    showToast("📋 Code loaded! Compiling...", "success");
    runWorker();
    
    // On mobile, seamlessly switch to 3D View to watch it compile!
    if (window.innerWidth <= 768) {
        switchMobileTab('preview');
    }
}

// Manual Paste Fallback Modal
function openPasteModal() {
    if (pasteModal) {
        pasteModal.classList.add('active');
        if (pasteInput) {
            pasteInput.value = '';
            setTimeout(() => pasteInput.focus(), 120);
        }
    }
}

function closePasteModal() {
    if (pasteModal) pasteModal.classList.remove('active');
}

if (btnPasteCancel) btnPasteCancel.addEventListener('click', closePasteModal);
if (btnPasteConfirm) {
    btnPasteConfirm.addEventListener('click', () => {
        if (pasteInput && pasteInput.value.trim()) {
            applyNewCode(pasteInput.value);
            closePasteModal();
        }
    });
}

async function handlePaste() {
    try {
        if (navigator.clipboard && navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
                applyNewCode(text);
                return;
            }
        }
        openPasteModal();
    } catch (err) {
        console.warn('Clipboard read error, showing paste modal:', err);
        openPasteModal();
    }
}

if (btnPaste) btnPaste.addEventListener('click', handlePaste);

// Copy Code
if (btnCopy) {
    btnCopy.addEventListener('click', async () => {
        if (!editor) return;
        const code = editor.getValue();
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(code);
            } else {
                const ta = document.createElement('textarea');
                ta.value = code;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            showToast("📋 Code copied to clipboard!", "success");
        } catch (err) {
            showToast("❌ Could not copy: " + err.message, "error");
        }
    });
}

// Open File Picker (Mobile & Desktop)
if (btnOpenFile && fileInput) {
    btnOpenFile.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => applyNewCode(event.target.result);
            reader.readAsText(file);
            fileInput.value = '';
        }
    });
}

// Render 3D Button
if (btnRender) {
    btnRender.addEventListener('click', () => {
        runWorker();
        if (window.innerWidth <= 768) {
            switchMobileTab('preview');
        }
    });
}

// Quick Center on Bed
if (btnMobileCenter) {
    btnMobileCenter.addEventListener('click', () => centerMeshOnBed(false));
}


// --- 7. Dimension Math & UI Sync ---
function getMultiplier() { return unitSelect && unitSelect.value === 'in' ? 25.4 : 1; }

function radToDegNorm(rad) {
    let deg = THREE.MathUtils.radToDeg(rad) % 360;
    if (deg > 180) deg -= 360;
    if (deg < -180) deg += 360;
    return parseFloat(deg.toFixed(1));
}

function updateUIFromGizmo() {
    if (isUpdatingFromUI || !currentMesh.geometry) return;
    const mult = getMultiplier();
    
    // Scale / Size
    if (dimX && dimY && dimZ) {
        dimX.value = (Math.abs(baseSize.x * currentMesh.scale.x) / mult).toFixed(2);
        dimY.value = (Math.abs(baseSize.z * currentMesh.scale.z) / mult).toFixed(2); 
        dimZ.value = (Math.abs(baseSize.y * currentMesh.scale.y) / mult).toFixed(2);
    }

    // Position (CAD X = Three.js X, CAD Y = Three.js Z, CAD Z = Three.js Y)
    if (posX && posY && posZ) {
        posX.value = (currentMesh.position.x / mult).toFixed(2);
        posY.value = (currentMesh.position.z / mult).toFixed(2);
        posZ.value = (currentMesh.position.y / mult).toFixed(2);
    }

    // Rotation (degrees)
    if (rotX && rotY && rotZ) {
        rotX.value = radToDegNorm(currentMesh.rotation.x).toFixed(1);
        rotY.value = radToDegNorm(currentMesh.rotation.z).toFixed(1);
        rotZ.value = radToDegNorm(currentMesh.rotation.y).toFixed(1);
    }
    
    if (boxHelper) boxHelper.update();
}

function updateGizmoFromUI(changedAxis) {
    if (!currentMesh.geometry) return;
    isUpdatingFromUI = true;
    const mult = getMultiplier();
    
    let targetX = Math.max(0.01, (parseFloat(dimX.value) * mult) / baseSize.x);
    let targetY = Math.max(0.01, (parseFloat(dimZ.value) * mult) / baseSize.y);
    let targetZ = Math.max(0.01, (parseFloat(dimY.value) * mult) / baseSize.z);

    if (uniformScale && uniformScale.checked) {
        let scaleVal = targetX;
        if (changedAxis === 'y') scaleVal = targetY;
        if (changedAxis === 'z') scaleVal = targetZ;
        targetX = targetY = targetZ = scaleVal;
    }

    currentMesh.scale.set(targetX, targetY, targetZ);
    updateUIFromGizmo(); 
    isUpdatingFromUI = false;
}

function updatePositionFromUI() {
    if (!currentMesh.geometry) return;
    isUpdatingFromUI = true;
    const mult = getMultiplier();
    
    currentMesh.position.x = (parseFloat(posX.value) || 0) * mult;
    currentMesh.position.z = (parseFloat(posY.value) || 0) * mult;
    currentMesh.position.y = (parseFloat(posZ.value) || 0) * mult;
    
    if (boxHelper) boxHelper.update();
    transformControl.attach(currentMesh);
    isUpdatingFromUI = false;
}

function updateRotationFromUI() {
    if (!currentMesh.geometry) return;
    isUpdatingFromUI = true;
    
    currentMesh.rotation.x = THREE.MathUtils.degToRad(parseFloat(rotX.value) || 0);
    currentMesh.rotation.z = THREE.MathUtils.degToRad(parseFloat(rotY.value) || 0);
    currentMesh.rotation.y = THREE.MathUtils.degToRad(parseFloat(rotZ.value) || 0);
    
    if (boxHelper) boxHelper.update();
    transformControl.attach(currentMesh);
    isUpdatingFromUI = false;
}

[dimX, dimY, dimZ].forEach((input, index) => {
    if (!input) return;
    const axis = ['x', 'z', 'y'][index];
    input.addEventListener('change', () => updateGizmoFromUI(axis));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
});

[posX, posY, posZ].forEach((input) => {
    if (!input) return;
    input.addEventListener('change', updatePositionFromUI);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
});

[rotX, rotY, rotZ].forEach((input) => {
    if (!input) return;
    input.addEventListener('change', updateRotationFromUI);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
});

document.getElementById('btn-rot-reset')?.addEventListener('click', () => {
    if (!currentMesh.geometry) return;
    currentMesh.rotation.set(0, 0, 0);
    if (boxHelper) boxHelper.update();
    transformControl.attach(currentMesh);
    updateUIFromGizmo();
});

document.getElementById('btn-rot-90z')?.addEventListener('click', () => {
    if (!currentMesh.geometry) return;
    currentMesh.rotation.y += Math.PI / 2;
    if (boxHelper) boxHelper.update();
    transformControl.attach(currentMesh);
    updateUIFromGizmo();
});

if (unitSelect) {
    unitSelect.addEventListener('change', () => {
        const newUnit = unitSelect.value;
        if (currentUnit !== newUnit) {
            if (newUnit === 'in') {
                if (gridSizeInput) {
                    gridSizeInput.value = (parseFloat(gridSizeInput.value) / 25.4).toFixed(2);
                    gridSizeInput.step = "0.25";
                }
                if (posX) posX.step = "0.05";
                if (posY) posY.step = "0.05";
                if (posZ) posZ.step = "0.05";
                if (dimX) dimX.step = "0.05";
                if (dimY) dimY.step = "0.05";
                if (dimZ) dimZ.step = "0.05";
            } else {
                if (gridSizeInput) {
                    gridSizeInput.value = Math.round(parseFloat(gridSizeInput.value) * 25.4);
                    gridSizeInput.step = "10";
                }
                if (posX) posX.step = "0.5";
                if (posY) posY.step = "0.5";
                if (posZ) posZ.step = "0.5";
                if (dimX) dimX.step = "0.1";
                if (dimY) dimY.step = "0.1";
                if (dimZ) dimZ.step = "0.1";
            }
            currentUnit = newUnit;
        }
        updateUIFromGizmo();
        updateBedGrid();
    });
}


// --- 8. Core Compilation Logic ---
function appendLog(text, type = "normal") {
    if (!consoleEl) return;
    const div = document.createElement('div');
    div.innerText = text;
    div.className = type === "error" ? "log-error" : "log-success";
    consoleEl.appendChild(div);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

function runWorker() {
    if (!editor) return; 
    
    showLoading('Compiling Model...');
    if (worker) worker.terminate(); 
    worker = new Worker('scad-worker.js?v=26', { type: 'module' });
    
    worker.onerror = (err) => {
        hideLoading();
        appendLog(`❌ Worker error: ${err.message || 'Compilation crashed'}`, "error");
        showToast("❌ Compilation crashed", "error");
    };

    worker.onmessage = (e) => {
        const { success, format, buffer, logs } = e.data;
        
        if (consoleEl) consoleEl.innerHTML = ''; 
        if (logs) logs.forEach(log => appendLog(log, success ? "normal" : "error"));

        const codeBadge = document.getElementById('code-badge');
        const previewBadge = document.getElementById('preview-badge');

        if (success) {
            appendLog("✅ Compilation successful.", "success");
            if (codeBadge) codeBadge.className = 'tab-badge';
            if (previewBadge) previewBadge.className = 'tab-badge';

            if (format === '3mf') {
                hideLoading();
                const blob = new Blob([buffer], { type: 'application/vnd.ms-3mfdocument' });
                downloadBlob(blob, 'parametric_model.3mf');
            } else if (format === 'stl') {
                showLoading('Rendering 3D Scene...');
                setTimeout(() => {
                    loadSTLToScene(buffer.buffer);
                    hideLoading();
                }, 20);
                return;
            }
        } else {
            hideLoading();
            appendLog(`❌ Compilation failed`, "error");
            if (codeBadge) codeBadge.className = 'tab-badge active';
            showToast("❌ OpenSCAD Syntax Error. Check Console.", "error");
        }
    };
    worker.postMessage({ code: editor.getValue(), format: 'stl' });
}

function loadSTLToScene(buffer) {
    transformControl.detach();
    if (currentMesh.geometry) {
        currentMesh.geometry.dispose();
        currentMesh.material.dispose();
    }
    scene.remove(currentMesh);
    if (boxHelper) scene.remove(boxHelper);
    
    const loader = new STLLoader();
    try {
        const geometry = loader.parse(buffer);
        geometry.rotateX(-Math.PI / 2); 
        
        const material = new THREE.MeshStandardMaterial({ 
            color: colorPicker ? colorPicker.value : '#cbd5e1', 
            roughness: 0.4, 
            metalness: 0.15 
        });
        currentMesh = new THREE.Mesh(geometry, material);
        currentMesh.castShadow = true;
        currentMesh.receiveShadow = true;
        
        geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        const box = geometry.boundingBox;
        box.getCenter(center);
        geometry.translate(-center.x, -box.min.y, -center.z); 
        
        const currentBox = new THREE.Box3().setFromObject(currentMesh);
        currentBox.getSize(baseSize);
        
        currentMesh.position.set(0, 0, 0); 
        scene.add(currentMesh);
        
        const toggleBounds = document.getElementById('toggle-bounds');
        if (toggleBounds && toggleBounds.checked) {
            boxHelper = new THREE.BoxHelper(currentMesh, 0x60a5fa);
            scene.add(boxHelper);
        }
        
        updateUIFromGizmo();
        transformControl.attach(currentMesh);
        
    } catch(err) {
        appendLog(`Render Error: ${err.message}`, "error");
        showToast("Render Error: " + err.message, "error");
    }
}

if (togglePrintVolume) {
    togglePrintVolume.addEventListener('change', (e) => {
        if (e.target.checked) drawPrintVolume();
        else if (printVolumeBox) {
            scene.remove(printVolumeBox);
            printVolumeBox.geometry.dispose();
            printVolumeBox.material.dispose();
            printVolumeBox = null;
        }
    });
}


// --- 9. Editor Toolbar & Bed Centering ---
document.getElementById('btn-undo')?.addEventListener('click', () => {
    if (editor) editor.trigger('keyboard', 'undo', null);
});
document.getElementById('btn-redo')?.addEventListener('click', () => {
    if (editor) editor.trigger('keyboard', 'redo', null);
});
document.getElementById('btn-clear')?.addEventListener('click', () => {
    if (editor && confirm("Clear all code in the editor?")) {
        editor.setValue("");
    }
});

function centerMeshOnBed(resetRotation = false) {
    if (!currentMesh.geometry) return;
    
    if (resetRotation) {
        currentMesh.rotation.set(0, 0, 0);
    }
    
    const box = new THREE.Box3().setFromObject(currentMesh);
    const center = new THREE.Vector3();
    box.getCenter(center);
    
    currentMesh.position.x -= center.x;
    currentMesh.position.z -= center.z;
    currentMesh.position.y -= box.min.y;
    
    if (boxHelper) boxHelper.update();
    transformControl.attach(currentMesh);
    updateUIFromGizmo();
    showToast("🎯 Centered on build plate", "success", 1800);
}

const btnCenterMesh = document.getElementById('btn-center-mesh');
if (btnCenterMesh) {
    btnCenterMesh.addEventListener('click', (e) => centerMeshOnBed(e.shiftKey));
}

function setGizmoMode(mode, btnId) {
    transformControl.setMode(mode);
    document.querySelectorAll('.gizmo-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(btnId)?.classList.add('active');

    if (panelTranslate) panelTranslate.style.display = (mode === 'translate') ? 'block' : 'none';
    if (panelRotate) panelRotate.style.display = (mode === 'rotate') ? 'block' : 'none';
    if (panelScale) panelScale.style.display = (mode === 'scale') ? 'block' : 'none';
    if (unitSelectRow) unitSelectRow.style.display = (mode === 'rotate') ? 'none' : 'flex';

    updateUIFromGizmo();
}

document.getElementById('btn-mode-translate')?.addEventListener('click', () => setGizmoMode('translate', 'btn-mode-translate'));
document.getElementById('btn-mode-rotate')?.addEventListener('click', () => setGizmoMode('rotate', 'btn-mode-rotate'));
document.getElementById('btn-mode-scale')?.addEventListener('click', () => setGizmoMode('scale', 'btn-mode-scale'));

window.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT') return;
    if (e.key.toLowerCase() === 't') setGizmoMode('translate', 'btn-mode-translate');
    if (e.key.toLowerCase() === 'r') setGizmoMode('rotate', 'btn-mode-rotate');
    if (e.key.toLowerCase() === 's') setGizmoMode('scale', 'btn-mode-scale');
    if (e.key.toLowerCase() === 'c') centerMeshOnBed(e.shiftKey);
    if (e.key.toLowerCase() === 'f') fitCameraToObject();
});

if (colorPicker) {
    colorPicker.addEventListener('input', (e) => {
        if (currentMesh.material) currentMesh.material.color.set(e.target.value);
    });
}

document.getElementById('toggle-bounds')?.addEventListener('change', (e) => {
    if (e.target.checked) {
        boxHelper = new THREE.BoxHelper(currentMesh, 0x60a5fa);
        scene.add(boxHelper);
    } else if (boxHelper) {
        scene.remove(boxHelper);
        boxHelper = null;
    }
});


// --- 10. Unified Exporters (Bambu Studio & Web Share API) ---
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

async function exportSTL() {
    if (!currentMesh.geometry) {
        showToast("⚠️ No 3D model to export. Please compile first.", "error");
        return;
    }

    transformControl.detach();
    if (boxHelper) boxHelper.visible = false;

    try {
        const exporter = new STLExporter();
        const result = exporter.parse(currentMesh, { binary: true });
        const blob = new Blob([result], { type: 'model/stl' });
        const filename = 'model_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.stl';

        // Direct download of the STL file
        downloadBlob(blob, filename);
        showToast("✅ STL file downloaded", "success");
    } catch (err) {
        showToast("❌ STL Export failed: " + err.message, "error");
    } finally {
        const toggleBounds = document.getElementById('toggle-bounds');
        if (boxHelper && toggleBounds && toggleBounds.checked) boxHelper.visible = true;
        transformControl.attach(currentMesh);
    }
}

if (btnExportStl) btnExportStl.addEventListener('click', exportSTL);
if (headerBtnExport) headerBtnExport.addEventListener('click', exportSTL);
if (btnMobileExport) btnMobileExport.addEventListener('click', exportSTL);

const btnExport3mf = document.getElementById('btn-export-3mf');
if (btnExport3mf) {
    btnExport3mf.addEventListener('click', () => {
        if (btnExport3mf.disabled) return;
        if (!currentMesh.geometry || !editor) return;
        showLoading('Baking 3MF...');

        const sX = currentMesh.scale.x.toFixed(3);
        const sY = currentMesh.scale.z.toFixed(3); 
        const sZ = currentMesh.scale.y.toFixed(3);
        
        const originalCode = editor.getValue();
        const parametricCode = `scale([${sX}, ${sY}, ${sZ}]) {\n${originalCode}\n}`;

        worker.postMessage({ code: parametricCode, format: '3mf' });
    });
}


// --- 11. Monaco Editor & Initialization ---
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});
require(['vs/editor/editor.main'], function() {
    
    const LOCAL_STORAGE_KEY = 'openscad-studio-saved-code';
    const savedCode = localStorage.getItem(LOCAL_STORAGE_KEY);
    const defaultCode = `// Parametric Twisted Hex Cup\n// Drag & Drop a local .scad file or tap Paste to load.\n\nheight = 45;\nradius = 24;\nwall = 2.5;\ntwist_deg = 90;\nsides = 6;\n\n$fn = 60;\neps = 0.01; // Microscopic overlap to prevent manifold errors\n\nunion() {\n    // 1. Solid floor\n    cylinder(h = wall + eps, r = radius, $fn = sides);\n\n    // 2. Hollow twisted walls\n    translate([0, 0, wall])\n        linear_extrude(height = height - wall, twist = twist_deg, slices = 60)\n            difference() {\n                circle(r = radius, $fn = sides);\n                circle(r = radius - wall, $fn = sides);\n            }\n}`;

    const oldDefaultPattern = 'difference() {\n    cube([40, 40, 20], center=true);';
    const initialCode = (savedCode === null || savedCode.includes(oldDefaultPattern)) ? defaultCode : savedCode;

    const isMobileDevice = window.innerWidth <= 768;
    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: initialCode,
        language: 'cpp', 
        theme: 'vs-dark', 
        minimap: { enabled: false }, 
        fontSize: isMobileDevice ? 12 : 14,
        automaticLayout: true,
        wordWrap: 'on',
        lineNumbersMinChars: isMobileDevice ? 2 : 3,
        folding: !isMobileDevice,
        glyphMargin: false,
        lineDecorationsWidth: isMobileDevice ? 4 : 10,
        scrollBeyondLastLine: false,
        scrollbar: {
            verticalScrollbarSize: isMobileDevice ? 6 : 10,
            horizontalScrollbarSize: isMobileDevice ? 6 : 10
        }
    });

    handleResponsiveLayout();
    runWorker(); 
    let compileTimeout;
    
    editor.onDidChangeModelContent(() => {
        localStorage.setItem(LOCAL_STORAGE_KEY, editor.getValue());
        
        if (saveStatus) {
            saveStatus.style.opacity = 1;
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => { saveStatus.style.opacity = 0; }, 1500);
        }

        clearTimeout(compileTimeout);
        compileTimeout = setTimeout(runWorker, 800); 
    });
});
