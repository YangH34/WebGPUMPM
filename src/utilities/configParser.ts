import {Vector3, Matrix4, Euler} from 'three';
import * as amongUsData from '../models/amongUsPoint.json';
import * as dogData from '../models/dogPoint.json';
import * as heartData from '../models/heartPoint.json';
import * as pikachuData from '../models/pikachuPoint.json';
import * as turkeyData from '../models/turkeyPoint.json';
import * as gravyData from '../models/gravyPoint.json';


// model and material options
export const models : Record<string, Float32Array> = {
    amongUs: new Float32Array(amongUsData["data"]),
    dog: new Float32Array(dogData["data"]),
    heart: new Float32Array(heartData["data"]),
    pikachu: new Float32Array(pikachuData["data"]),
    turkey: new Float32Array(turkeyData["data"]),
    gravy: new Float32Array(gravyData["data"])
}

export let materials : Record<string, number> = {
    jello: 0,
    jelloG: 0.1,
    jelloP: 0.2,
    jelloB: 0.3,
    jelloFur: 0.4,
    snow: 1,
    fluid: 2,
    fluidR: 2.1,
    fluidGravy: 2.2
};

// p1 buffer
export function toVec3s(model : Float32Array) : Array<Vector3>{
    var vec3Arr = [];
    const pointCount = model.length/4;
    for(let i = 0; i < pointCount; i++) {
        let idx = i * 4;
        vec3Arr.push(new Vector3(model[idx], model[idx+1], model[idx+2]));
    }
    return vec3Arr;
}

export function transformVec3(vec3Arr: Array<Vector3>, rotation: Euler, translation: Vector3, scale: number, gridWidth: number) : Array<Vector3>{
    let t1 = new Matrix4().scale(new Vector3(scale, scale, scale));
    let t2 = new Matrix4().makeRotationFromEuler(rotation);
    let t3 = new Matrix4().setPosition(translation);
    let transform = t3.multiply(t2).multiply(t1);

    vec3Arr.forEach(function(point) {
        point.applyMatrix4(transform);
    });

    let oldLength = vec3Arr.length;
    let gridScale = 0.04/gridWidth;
    let newLength = Math.ceil(oldLength * (scale * scale * scale) * (gridScale*gridScale*gridScale));
    if (newLength > oldLength) {
        newLength = oldLength;
    }
    return vec3Arr.slice(0,newLength);
}

export function createParticleArray(transformedPoints: Array<Vector3>, mat: number, vel: Vector3, mass: number) : Float32Array{
    let numP = transformedPoints.length;
    let arr = new Float32Array(numP*8);
    for(let i = 0; i < numP; i++) {
        let point = transformedPoints[i];
        let idx = i*8;
        arr[idx]   = point.x;
        arr[idx+1] = point.y;
        arr[idx+2] = point.z;
        arr[idx+3] = mat;
        arr[idx+4] = vel.x;
        arr[idx+5] = vel.y;
        arr[idx+6] = vel.z;
        arr[idx+7] = mass;
    }
    return arr;
}

export function mergeParticleArrays(particleArrays: Array<Float32Array>) : Float32Array{
    var totalLength = 0;
    for(let i = 0; i < particleArrays.length; i++) {
        totalLength = totalLength + particleArrays[i].length;
    }
    let mergedArr = new Float32Array(totalLength);
    var offset = 0;
    for(let i = 0; i < particleArrays.length; i++) {
        let object = particleArrays[i];
        for(let j = 0; j < object.length; j++) {
            mergedArr[j+offset] = object[j];
        }
        offset += object.length;
    }
    return mergedArr;
}

// p2 buffer
let matIdentity : number[] = [1, 0, 0, 0,/*Col 1*/ 0, 1, 0, 0,/*Col 2*/ 0, 0, 1, 0/*Col 3*/];
export function fillP2Data(p2Data : Float32Array, numP: number, volumeP: number) {
    for (let i = 0; i < numP; i++) {
        for (let matrixIndex = 0; matrixIndex < 12; matrixIndex++) {
            p2Data[52 * i + matrixIndex] = matIdentity[matrixIndex]; // Deformation Graident Of The Particle (12 floats)
            p2Data[52 * i + 12 + matrixIndex] = matIdentity[matrixIndex]; // Elastic Component Of The Deformation Gradient Of The Particle (12 floats)
            p2Data[52 * i + 24 + matrixIndex] = matIdentity[matrixIndex];  // Plastic Component Of The Deformation Gradient Of The Particle (12 floats)
            p2Data[52 * i + 36 + matrixIndex] = matIdentity[matrixIndex];  // APIC's C Matrix Of The Particle (12 floats)
        }
    
        p2Data[52 * i + 48] = 1.0;  // J attribute Of The Particle (1 float)
        p2Data[52 * i + 49] = volumeP;  // Volume Of The Particle (1 float)
        p2Data[52 * i + 50] = 0;  // Padding to match the 4 floats alignment (1 float)
        p2Data[52 * i + 51] = 0;  // Padding to match the 4 floats alignment (1 float)
    }
}

// g buffer
function ilog2(x) {
    let lg = 0;
    while (x = x >> 1) {
        ++lg;
    }
    return lg;
}

export function ilog2ceil(x) {
    return x == 1 ? 0 : ilog2(x - 1) + 1;
}

export function getNumGPadded(n) {
    let paddedSize = 1 << ilog2ceil(n);
    let nPadded = n;
    if (paddedSize > n) {
        nPadded = paddedSize;
    }
    return nPadded;
}
