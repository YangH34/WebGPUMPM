export const evolveFandJShader = {
evolveFandJ: (numPArg: number, numGArg: number, numGPaddedArg: number) => `#version 450
layout(std140, set = 0, binding = 0) uniform SimParams {
  float dt; // Timestep
  float gravityX;  // Gravity (x-component)
  float gravityY;  // Gravity (y-component)
  float gravityZ;  // Gravity (z-component)
  float minCornerX; // Min corner of the grid (x-component) (also works as the origin of the grid for offsetting purposes)
  float minCornerY; // Min corner of the grid (y-component) (also works as the origin of the grid for offsetting purposes)
  float minCornerZ; // Min corner of the grid (z-component) (also works as the origin of the grid for offsetting purposes)
  float maxCornerX;  // Max corner of the grid (x-component)
  float maxCornerY;  // Max corner of the grid (y-component)
  float maxCornerZ;  // Max corner of the grid (z-component)
  float h; // Cell width of the grid
  float nxG;  // Number of grid points in the x-direction
  float nyG;  // Number of grid points in the y-direction
  float nzG;  // Number of grid points in the z-direction
  float numG; // Total number of grid points
  float E;  // Young's Modulus (Hardness)
  float E0; // Initial Young's Modulus (for snow)
  float nu; // Poisson's Ratio (Incompressibility)
  float nuSnow; // Poisson's Ratio (for snow)
  float thetaC; // Critical compression (for snow)
  float thetaS;  // Critical stretch (for snow)
  float xi;  // Hardening coefficient (for snow)
  float mu;  // One of the Lamé parameters
  float lambda;  // One of the Lamé parameters
  float lambdaFluid; // parameter for fluid
  float gamma;  // parameter for fluid
  float rhoJello;  // Density of the points' material for jello
  float rhoSnow;  // Density of the points' material for snow
  float rhoFluid; // Density of the points' material for fluid
  float numP;  // Total number of points
  float PADDING_1; // IGNORE
  float PADDING_2; // IGNORE
} params;
struct ParticleStruct1 {
  vec4 pos; // (pos.xyz => Particle Position, pos.w => Particle Material Type)
  vec4 v; // (v.xyz => Particle Velocity, v.w => Particle Mass)
};
struct ParticleStruct2 {
  mat3 F; // Deformation Graident Of The Particle
  mat3 Fe;  // Elastic Component Of The Deformation Gradient Of The Particle
  mat3 Fp;  // Plastic Component Of The Deformation Gradient Of The Particle
  mat3 C; // APIC's C Matrix Of The Particle
  float J;  // J attribute Of The Particle
  float vol;  // Volume Of The Particle
  float PADDING_1;  // (IGNORE)
  float PADDING_2;  // (IGNORE)
};
struct GridNodeStruct {
  vec3 vN;  // New Velocity Stored On The Grid Node
  vec3 v; // Old Velocity Stored On The Grid Node
  vec3 force; // Force Stored On The Grid Node
  float m;  // Mass Stored On The Grid Node
  float PADDING_1;  // (IGNORE)
  float PADDING_2;  // (IGNORE)
  float PADDING_3;  // (IGNORE)
};
struct StreamCompStruct {
    float criteria; // Criteria (Only Has Value 0 Or 1)
    float scan; // Scan Result (Result Of Exclusive Scanning The Criteria Buffer)
    float compact; // Stream Compaction Result (Final Result Of Stream Compaction After Scattering)
    float d; // Iteration Depth (Storing The Current Iteration Depth In Up-Sweep And Down-Sweep)
  };
layout(std430, set = 0, binding = 1) buffer PARTICLES1 {
  ParticleStruct1 data[${numPArg}];
} particles1;
layout(std430, set = 0, binding = 2) buffer PARTICLES2 {
  ParticleStruct2 data[${numPArg}];
} particles2;
layout(std430, set = 0, binding = 3) buffer GRIDNODES {
  GridNodeStruct data[${numGArg}];
} gridNodes;
layout(std430, set = 0, binding = 4) buffer STREAMCOMPACTION {
  StreamCompStruct data[${numGPaddedArg}];
} SC;

// Compute weights (when each thread handles a particle)
void computeWeights1D_P(float x, out vec3 w, out vec3 dw, out int baseNode) {
  // x is the particle's index-space position and can represent particle's index-space position in x, y, or z direction,
  // baseNode can also represent the baseNode in x, y, or z direction, depending on how this function is used
  // Note that here we compute the 1D quadratic B spline weights and
  // x is assumed to be scaled in the index space (in other words, the grid has cell width of length 1)
  baseNode = int(floor(x - 0.5));
  float d0 = x - baseNode;
  w[0] = 0.5 * (1.5 - d0) * (1.5 - d0);
  dw[0] = d0 - 1.5;
  float d1 = x - (baseNode + 1);
  w[1] = 0.75 - d1 * d1;
  dw[1] = -2 * d1;
  float d2 = x - (baseNode + 2);
  w[2] = 0.5 * (1.5 + d2) * (1.5 + d2);
  dw[2] = 1.5 + d2;
}
/* ---------------------------------------------------------------------------- */
/* ----------------------------- SVD START ------------------------------------ */
/* ---------------------------------------------------------------------------- */
// This is a GLSL implementation of
// "Computing the Singular Value Decomposition of 3 x 3 matrices with
// minimal branching and elementary floating point operations"
// by Aleka McAdams et.al.
// http://pages.cs.wisc.edu/~sifakis/papers/SVD_TR1690.pdf
// This should also work on the CPU using glm
// Then you probably should use glm::quat instead of vec4
// and mat3_cast to convert to mat3.
// GAMMA = 3 + sqrt(8)
// C_STAR = cos(pi/8)
// S_STAR = sin(pi/8)
#define GAMMA 5.8284271247
#define C_STAR 0.9238795325
#define S_STAR 0.3826834323
#define SVD_EPS 0.0000001
vec2 approx_givens_quat(float s_pp, float s_pq, float s_qq) {
    float c_h = 2 * (s_pp - s_qq);
    float s_h2 = s_pq * s_pq;
    float c_h2 = c_h * c_h;
    if (GAMMA * s_h2 < c_h2) {
        float omega = 1.0f / sqrt(s_h2 + c_h2);
        return vec2(omega * c_h, omega * s_pq);
    }
    return vec2(C_STAR, S_STAR);
}
// the quaternion is stored in vec4 like so:
// (c, s * vec3) meaning that .x = c
mat3 quat_to_mat3(vec4 quat) {
    float qx2 = quat.y * quat.y;
    float qy2 = quat.z * quat.z;
    float qz2 = quat.w * quat.w;
    float qwqx = quat.x * quat.y;
    float qwqy = quat.x * quat.z;
    float qwqz = quat.x * quat.w;
    float qxqy = quat.y * quat.z;
    float qxqz = quat.y * quat.w;
    float qyqz = quat.z * quat.w;
    return mat3(1.0f - 2.0f * (qy2 + qz2), 2.0f * (qxqy + qwqz), 2.0f * (qxqz - qwqy),
        2.0f * (qxqy - qwqz), 1.0f - 2.0f * (qx2 + qz2), 2.0f * (qyqz + qwqx),
        2.0f * (qxqz + qwqy), 2.0f * (qyqz - qwqx), 1.0f - 2.0f * (qx2 + qy2));
}
mat3 symmetric_eigenanalysis(mat3 A) {
    mat3 S = transpose(A) * A;
    // jacobi iteration
    mat3 q = mat3(1.0f);
    for (int i = 0; i < 5; i++) {
        vec2 ch_sh = approx_givens_quat(S[0].x, S[0].y, S[1].y);
        vec4 ch_sh_quat = vec4(ch_sh.x, 0, 0, ch_sh.y);
        mat3 q_mat = quat_to_mat3(ch_sh_quat);
        S = transpose(q_mat) * S * q_mat;
        q = q * q_mat;
        ch_sh = approx_givens_quat(S[0].x, S[0].z, S[2].z);
        ch_sh_quat = vec4(ch_sh.x, 0, -ch_sh.y, 0);
        q_mat = quat_to_mat3(ch_sh_quat);
        S = transpose(q_mat) * S * q_mat;
        q = q * q_mat;
        ch_sh = approx_givens_quat(S[1].y, S[1].z, S[2].z);
        ch_sh_quat = vec4(ch_sh.x, ch_sh.y, 0, 0);
        q_mat = quat_to_mat3(ch_sh_quat);
        S = transpose(q_mat) * S * q_mat;
        q = q * q_mat;
    }
    return q;
}
vec2 approx_qr_givens_quat(float a0, float a1) {
    float rho = sqrt(a0 * a0 + a1 * a1);
    float s_h = a1;
    float max_rho_eps = rho;
    if (rho <= SVD_EPS) {
        s_h = 0;
        max_rho_eps = SVD_EPS;
    }
    float c_h = max_rho_eps + a0;
    if (a0 < 0) {
        float temp = c_h - 2 * a0;
        c_h = s_h;
        s_h = temp;
    }
    float omega = 1.0f / sqrt(c_h * c_h + s_h * s_h);
    return vec2(omega * c_h, omega * s_h);
}
struct QR_mats {
    mat3 Q;
    mat3 R;
};
QR_mats qr_decomp(mat3 B) {
    QR_mats qr_decomp_result;
    mat3 R;
    // 1 0
    // (ch, 0, 0, sh)
    vec2 ch_sh10 = approx_qr_givens_quat(B[0].x, B[0].y);
    mat3 Q10 = quat_to_mat3(vec4(ch_sh10.x, 0, 0, ch_sh10.y));
    R = transpose(Q10) * B;
    // 2 0
    // (ch, 0, -sh, 0)
    vec2 ch_sh20 = approx_qr_givens_quat(R[0].x, R[0].z);
    mat3 Q20 = quat_to_mat3(vec4(ch_sh20.x, 0, -ch_sh20.y, 0));
    R = transpose(Q20) * R;
    // 2 1
    // (ch, sh, 0, 0)
    vec2 ch_sh21 = approx_qr_givens_quat(R[1].y, R[1].z);
    mat3 Q21 = quat_to_mat3(vec4(ch_sh21.x, ch_sh21.y, 0, 0));
    R = transpose(Q21) * R;
    qr_decomp_result.R = R;
    qr_decomp_result.Q = Q10 * Q20 * Q21;
    return qr_decomp_result;
}
struct SVD_mats {
    mat3 U;
    mat3 Sigma;
    mat3 V;
};
SVD_mats svd(mat3 A) {
    SVD_mats svd_result;
    svd_result.V = symmetric_eigenanalysis(A);
    mat3 B = A * svd_result.V;
    // sort singular values
    float rho0 = dot(B[0], B[0]);
    float rho1 = dot(B[1], B[1]);
    float rho2 = dot(B[2], B[2]);
    if (rho0 < rho1) {
        vec3 temp = B[1];
        B[1] = -B[0];
        B[0] = temp;
        temp = svd_result.V[1];
        svd_result.V[1] = -svd_result.V[0];
        svd_result.V[0] = temp;
        float temp_rho = rho0;
        rho0 = rho1;
        rho1 = temp_rho;
    }
    if (rho0 < rho2) {
        vec3 temp = B[2];
        B[2] = -B[0];
        B[0] = temp;
        temp = svd_result.V[2];
        svd_result.V[2] = -svd_result.V[0];
        svd_result.V[0] = temp;
        rho2 = rho0;
    }
    if (rho1 < rho2) {
        vec3 temp = B[2];
        B[2] = -B[1];
        B[1] = temp;
        temp = svd_result.V[2];
        svd_result.V[2] = -svd_result.V[1];
        svd_result.V[1] = temp;
    }
    QR_mats QR = qr_decomp(B);
    svd_result.U = QR.Q;
    svd_result.Sigma = QR.R;
    return svd_result;
}
/* ---------------------------------------------------------------------------- */
/* ----------------------------- SVD END ------------------------------------ */
/* ---------------------------------------------------------------------------- */
int coordinateToId(ivec3 c) {
  return c[0] + int(params.nxG) * c[1] + int(params.nxG) * int(params.nyG) * c[2];
}
void main() {
  uint index = gl_GlobalInvocationID.x;
  if (index >= ${numPArg}) { return; }
  // loop through the nearby 3*3*3 grids
  vec3 minCorner = vec3(params.minCornerX, params.minCornerY, params.minCornerZ);
  vec3 posP_index_space = (particles1.data[index].pos.xyz - minCorner) / params.h;
  vec3 wI, wJ, wK;
  vec3 dwI, dwJ, dwK;
  int baseNodeI, baseNodeJ, baseNodeK;
  computeWeights1D_P(posP_index_space.x, wI, dwI, baseNodeI);
  computeWeights1D_P(posP_index_space.y, wJ, dwJ, baseNodeJ);
  computeWeights1D_P(posP_index_space.z, wK, dwK, baseNodeK);
  mat3 grad_vP = mat3(0.0);
  float vP = 0.0;
  int material = int(round(particles1.data[index].pos.w));
  
  for (int k = 0; k < 3; k++) {
    for (int j = 0; j < 3; j++) {
        for (int i = 0; i < 3; i++) {
            int nodeI = baseNodeI + i;
            int nodeJ = baseNodeJ + j;
            int nodeK = baseNodeK + k;
            int nodeID = coordinateToId(ivec3(nodeI, nodeJ, nodeK));
            vec3 grad_weightIJK = vec3(dwI[i] * wJ[j] * wK[k] / params.h,
                                        wI[i] * dwJ[j] * wK[k] / params.h,
                                        wI[i] * wJ[j] * dwK[k] / params.h);
            
            // jello is 0, snow is 1, fluid is 2
            if (material == 0 || material == 1) {
              // jello or snow
              grad_vP += outerProduct(gridNodes.data[nodeID].vN, grad_weightIJK);
            }
            if (material == 2) {
              // fluid
              vP += dot(gridNodes.data[nodeID].vN, grad_weightIJK);
            }
        }
    }
  }
   
  // jello is 0, snow is 1, fluid is 2
  if (material == 0) {
    // jello
     particles2.data[index].F = (mat3(1.0) + params.dt * grad_vP) * particles2.data[index].F;
  } else if (material == 1) {
    // snow
    mat3 FePNew = (mat3(1.0) + params.dt * grad_vP) * particles2.data[index].Fe;
    mat3 FPNew = FePNew * particles2.data[index].Fp;
    // correct FePNew
    mat3 u, sigma, v;
    SVD_mats FePNew_SVD = svd(FePNew);
    u = FePNew_SVD.U;
    sigma = FePNew_SVD.Sigma;
    v = FePNew_SVD.V;
    // Clamping the singular values of sigma
    sigma[0].x = max(1.0 - params.thetaC, min(sigma[0].x, 1.0 + params.thetaS));
    sigma[1].y = max(1.0 - params.thetaC, min(sigma[1].y, 1.0 + params.thetaS));
    sigma[2].z = max(1.0 - params.thetaC, min(sigma[2].z, 1.0 + params.thetaS));
    FePNew = u * sigma * transpose(v);
    particles2.data[index].Fe = FePNew;
    particles2.data[index].Fp = inverse(FePNew) * FPNew;
  } else if (material == 2) {
    //fluid
    particles2.data[index].J = particles2.data[index].J * (1.0 + params.dt * vP);
  }
}`,
};