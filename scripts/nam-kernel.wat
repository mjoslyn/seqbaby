;; The NAM stage's inner loops (public/js/nam.js), in WebAssembly SIMD.
;; Built into public/js/namKernel.js by scripts/make-nam-kernel.mjs.
;;
;; Everything is a block of frames, f32, four at a time. Pointers and strides
;; are BYTES. A frame count n is rounded up to four: every row written must
;; have three floats of slack after n (nam.js lays them out so).
;; Address 0..63 is kept zero, so a bias pointer of 0 is "no bias".
(module
  (memory (export "mem") 1)

  ;; dst[i][t] += sum_j W[i*cols + j] * src[j][t]   (rows x cols matrix, row-major)
  ;; dst rows ds bytes apart, src rows ss bytes apart, t in [0, n)
  (func (export "mmacc")
    (param $dst i32) (param $ds i32) (param $src i32) (param $ss i32)
    (param $w i32) (param $rows i32) (param $cols i32) (param $n i32)
    (local $i i32) (local $j i32) (local $t i32) (local $nb i32)
    (local $drow i32) (local $wp i32)
    (local $s0 i32) (local $s1 i32) (local $s2 i32) (local $s3 i32)
    (local $w0 v128) (local $w1 v128) (local $w2 v128) (local $w3 v128) (local $a v128)
    (local.set $nb (i32.shl (i32.and (i32.add (local.get $n) (i32.const 3)) (i32.const -4)) (i32.const 2)))
    (local.set $wp (local.get $w))
    (block $ei (loop $li
      (br_if $ei (i32.ge_s (local.get $i) (local.get $rows)))
      (local.set $drow (i32.add (local.get $dst) (i32.mul (local.get $i) (local.get $ds))))
      (local.set $j (i32.const 0))
      (block $ej4 (loop $lj4
        (br_if $ej4 (i32.gt_s (i32.add (local.get $j) (i32.const 4)) (local.get $cols)))
        (local.set $w0 (f32x4.splat (f32.load (local.get $wp))))
        (local.set $w1 (f32x4.splat (f32.load offset=4 (local.get $wp))))
        (local.set $w2 (f32x4.splat (f32.load offset=8 (local.get $wp))))
        (local.set $w3 (f32x4.splat (f32.load offset=12 (local.get $wp))))
        (local.set $s0 (i32.add (local.get $src) (i32.mul (local.get $j) (local.get $ss))))
        (local.set $s1 (i32.add (local.get $s0) (local.get $ss)))
        (local.set $s2 (i32.add (local.get $s1) (local.get $ss)))
        (local.set $s3 (i32.add (local.get $s2) (local.get $ss)))
        (local.set $t (i32.const 0))
        (block $et (loop $lt
          (br_if $et (i32.ge_u (local.get $t) (local.get $nb)))
          (local.set $a (v128.load (i32.add (local.get $drow) (local.get $t))))
          (local.set $a (f32x4.add (local.get $a)
            (f32x4.add
              (f32x4.add
                (f32x4.mul (local.get $w0) (v128.load (i32.add (local.get $s0) (local.get $t))))
                (f32x4.mul (local.get $w1) (v128.load (i32.add (local.get $s1) (local.get $t)))))
              (f32x4.add
                (f32x4.mul (local.get $w2) (v128.load (i32.add (local.get $s2) (local.get $t))))
                (f32x4.mul (local.get $w3) (v128.load (i32.add (local.get $s3) (local.get $t))))))))
          (v128.store (i32.add (local.get $drow) (local.get $t)) (local.get $a))
          (local.set $t (i32.add (local.get $t) (i32.const 16)))
          (br $lt)))
        (local.set $wp (i32.add (local.get $wp) (i32.const 16)))
        (local.set $j (i32.add (local.get $j) (i32.const 4)))
        (br $lj4)))
      (block $ej (loop $lj
        (br_if $ej (i32.ge_s (local.get $j) (local.get $cols)))
        (local.set $w0 (f32x4.splat (f32.load (local.get $wp))))
        (local.set $s0 (i32.add (local.get $src) (i32.mul (local.get $j) (local.get $ss))))
        (local.set $t (i32.const 0))
        (block $et1 (loop $lt1
          (br_if $et1 (i32.ge_u (local.get $t) (local.get $nb)))
          (v128.store (i32.add (local.get $drow) (local.get $t))
            (f32x4.add (v128.load (i32.add (local.get $drow) (local.get $t)))
              (f32x4.mul (local.get $w0) (v128.load (i32.add (local.get $s0) (local.get $t))))))
          (local.set $t (i32.add (local.get $t) (i32.const 16)))
          (br $lt1)))
        (local.set $wp (i32.add (local.get $wp) (i32.const 4)))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $lj)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $li)))
  )

  ;; dst[i][t] = src[i][t] + bias[i]; src 0 means no src (dst = bias)
  (func (export "setb")
    (param $dst i32) (param $ds i32) (param $src i32) (param $ss i32)
    (param $bias i32) (param $rows i32) (param $n i32)
    (local $i i32) (local $t i32) (local $nb i32) (local $drow i32) (local $srow i32) (local $b v128)
    (local.set $nb (i32.shl (i32.and (i32.add (local.get $n) (i32.const 3)) (i32.const -4)) (i32.const 2)))
    (block $ei (loop $li
      (br_if $ei (i32.ge_s (local.get $i) (local.get $rows)))
      (local.set $drow (i32.add (local.get $dst) (i32.mul (local.get $i) (local.get $ds))))
      (local.set $b (f32x4.splat (f32.load (i32.add (local.get $bias)
        (select (i32.const 0) (i32.shl (local.get $i) (i32.const 2)) (i32.eqz (local.get $bias)))))))
      (local.set $t (i32.const 0))
      (if (i32.eqz (local.get $src))
        (then
          (block $e0 (loop $l0
            (br_if $e0 (i32.ge_u (local.get $t) (local.get $nb)))
            (v128.store (i32.add (local.get $drow) (local.get $t)) (local.get $b))
            (local.set $t (i32.add (local.get $t) (i32.const 16)))
            (br $l0))))
        (else
          (local.set $srow (i32.add (local.get $src) (i32.mul (local.get $i) (local.get $ss))))
          (block $e1 (loop $l1
            (br_if $e1 (i32.ge_u (local.get $t) (local.get $nb)))
            (v128.store (i32.add (local.get $drow) (local.get $t))
              (f32x4.add (local.get $b) (v128.load (i32.add (local.get $srow) (local.get $t)))))
            (local.set $t (i32.add (local.get $t) (i32.const 16)))
            (br $l1)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $li)))
  )

  ;; NAM's fast tanh, in place, over count floats (a multiple of four)
  (func (export "tanh") (param $p i32) (param $count i32)
    (local $e i32) (local $x v128) (local $ax v128) (local $x2 v128) (local $d v128)
    (local.set $e (i32.add (local.get $p) (i32.shl (local.get $count) (i32.const 2))))
    (block $ee (loop $l
      (br_if $ee (i32.ge_u (local.get $p) (local.get $e)))
      (local.set $x (v128.load (local.get $p)))
      (local.set $ax (f32x4.abs (local.get $x)))
      (local.set $x2 (f32x4.mul (local.get $x) (local.get $x)))
      (local.set $d (f32x4.abs (f32x4.add (local.get $x)
        (f32x4.mul (f32x4.mul (f32x4.splat (f32.const 0.814642734961073)) (local.get $x)) (local.get $ax)))))
      (v128.store (local.get $p)
        (f32x4.div
          (f32x4.mul (local.get $x)
            (f32x4.add
              (f32x4.add (f32x4.splat (f32.const 2.45550750702956))
                (f32x4.mul (f32x4.splat (f32.const 2.45550750702956)) (local.get $ax)))
              (f32x4.mul
                (f32x4.add (f32x4.splat (f32.const 0.893229853513558))
                  (f32x4.mul (f32x4.splat (f32.const 0.821226666969744)) (local.get $ax)))
                (local.get $x2))))
          (f32x4.add (f32x4.splat (f32.const 2.44506634652299))
            (f32x4.mul (f32x4.add (f32x4.splat (f32.const 2.44506634652299)) (local.get $x2)) (local.get $d)))))
      (local.set $p (i32.add (local.get $p) (i32.const 16)))
      (br $l)))
  )

  ;; d[t] += s[t] over count floats (a multiple of four)
  (func (export "vadd") (param $d i32) (param $s i32) (param $count i32)
    (local $e i32)
    (local.set $e (i32.add (local.get $d) (i32.shl (local.get $count) (i32.const 2))))
    (block $ee (loop $l
      (br_if $ee (i32.ge_u (local.get $d) (local.get $e)))
      (v128.store (local.get $d) (f32x4.add (v128.load (local.get $d)) (v128.load (local.get $s))))
      (local.set $d (i32.add (local.get $d) (i32.const 16)))
      (local.set $s (i32.add (local.get $s) (i32.const 16)))
      (br $l)))
  )
)
