import librosa
import numpy as np
from pathlib import Path
from scipy.signal import savgol_filter
from fastdtw import fastdtw
from numpy.fft import rfft, irfft
import multiprocessing
from functools import partial
import sys
import pickle

def circular_semitone_distance(a, b):
    """
    Measures distance between two MIDI notes in circular semitone space
    (12 semitones = 0 distance).
    """
    diff = abs(a - b)
    return min(diff, 12 - diff)

def process_audio_chunk(chunk, sr, frame_length, hop_length):
    """Process a single audio chunk for pitch detection."""
    rms = librosa.feature.rms(y=chunk, frame_length=frame_length, hop_length=hop_length)[0]
    energy_threshold = np.mean(rms) * 0.02

    try:
        f0, voiced_flag, _ = librosa.pyin(
            chunk,
            fmin=65.4,
            fmax=523.25,
            sr=sr,
            frame_length=frame_length,
            hop_length=hop_length,
            fill_na=0.0
        )
    except Exception:
        return np.zeros_like(rms), np.zeros_like(rms, dtype=bool)

    if len(rms) != len(f0):
        rms = librosa.util.fix_length(rms, len(f0))

    energy_mask = rms > energy_threshold
    f0 = np.where(energy_mask & voiced_flag, f0, 0.0)
    return f0, voiced_flag

class ReferenceCache:
    def __init__(self, cache_dir):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)
        
    def _get_cache_path(self, reference_path):
        reference_filename = Path(reference_path).stem
        cache_path = self.cache_dir / f"{reference_filename}_cache.pkl"
        return cache_path
    
    def get_cached_analysis(self, reference_path):
        cache_path = self._get_cache_path(reference_path)
        if cache_path.exists():
            try:
                with open(cache_path, 'rb') as f:
                    return pickle.load(f)
            except Exception:
                return None
        return None
    
    def cache_analysis(self, reference_path, analysis_data):
        cache_path = self._get_cache_path(reference_path)
        try:
            with open(cache_path, 'wb') as f:
                pickle.dump(analysis_data, f)
        except Exception:
            pass

class KaraokeScorer:
    def __init__(self, vocals_path, cache_dir=None):
        """
        Initialize the KaraokeScorer with a reference vocal track.
        
        Args:
            vocals_path (str or Path): Path to the reference vocals WAV file
            cache_dir (str or Path, optional): Directory for caching analysis
        """
        self.sample_rate = 44100
        self.frame_length = 2048
        self.hop_length = self.frame_length // 4
        
        if cache_dir:
            self.cache = ReferenceCache(cache_dir)
            cached_data = self.cache.get_cached_analysis(vocals_path)
            if cached_data:
                self._load_cached_data(cached_data)
                return

        self._analyze_reference_vocals(vocals_path)
        
        if cache_dir:
            cache_data = {
                'ref_f0': self.ref_f0,
                'ref_midi': self.ref_midi,
                'ref_midi_norm': self.ref_midi_norm,
                'ref_midi_smooth': self.ref_midi_smooth
            }
            self.cache.cache_analysis(vocals_path, cache_data)
    
    def _load_cached_data(self, cached_data):
        self.ref_f0 = cached_data['ref_f0']
        self.ref_midi = cached_data['ref_midi']
        self.ref_midi_norm = cached_data['ref_midi_norm']
        self.ref_midi_smooth = cached_data['ref_midi_smooth']
        
    def _analyze_reference_vocals(self, vocals_path):
        """Analyze the reference vocal track."""
        reference_audio, _ = librosa.load(
            str(vocals_path),
            sr=self.sample_rate,
            mono=True
        )

        chunk_size = self.sample_rate * 10
        chunks = [reference_audio[i:i + chunk_size] 
                 for i in range(0, len(reference_audio), chunk_size)]

        with multiprocessing.Pool() as pool:
            process_chunk = partial(
                process_audio_chunk,
                sr=self.sample_rate,
                frame_length=self.frame_length,
                hop_length=self.hop_length
            )
            results = pool.map(process_chunk, chunks)

        self.ref_f0 = np.concatenate([r[0] for r in results])
        self.ref_midi = self.convert_to_midi(self.ref_f0)
        self.ref_midi_norm = self.normalize_to_octave(self.ref_midi)
        self.ref_midi_smooth = self.get_smooth_pitch_curve(self.ref_midi_norm)

    def score_performance_file(self, performance_path):
        """
        Score a performance from an audio file (supports WAV, MP3, WebM).
        
        Args:
            performance_path (str or Path): Path to the performance audio file
            
        Returns:
            dict: Contains melody_score and final_score
        """
        try:
            # Load and convert to mono if necessary
            performance_audio, orig_sr = librosa.load(
                performance_path,
                sr=self.sample_rate,  # Resample to match reference
                mono=True
            )
            
            return self.score_audio_data(performance_audio)
            
        except Exception as e:
            print(f"Error processing performance file: {e}")
            return {'melody_score': 0.0, 'final_score': 0.0}

    def score_audio_data(self, audio_data, sample_rate=44100):
        """
        Score audio data directly.
        
        Args:
            audio_data: numpy array of audio samples
            sample_rate: sample rate of the audio data
            
        Returns:
            dict containing melody_score and final_score
        """
        if sample_rate != self.sample_rate:
            audio_data = librosa.resample(
                audio_data, 
                orig_sr=sample_rate,
                target_sr=self.sample_rate
            )
        
        try:
            chunk_size = self.sample_rate * 10
            chunks = [audio_data[i:i + chunk_size] 
                     for i in range(0, len(audio_data), chunk_size)]

            with multiprocessing.Pool() as pool:
                process_chunk = partial(
                    process_audio_chunk,
                    sr=self.sample_rate,
                    frame_length=self.frame_length,
                    hop_length=self.hop_length
                )
                results = pool.map(process_chunk, chunks)

            perf_f0 = np.concatenate([r[0] for r in results])
            
            if np.all(perf_f0 == 0):
                return {'melody_score': 0.0, 'final_score': 0.0}

            perf_midi = self.convert_to_midi(perf_f0)
            perf_midi_norm = self.normalize_to_octave(perf_midi)
            perf_midi_smooth = self.get_smooth_pitch_curve(perf_midi_norm)

            shift_est = self.estimate_shift_via_xcorr(
                self.ref_midi_smooth,
                perf_midi_smooth
            )

            perf_midi_shifted = np.roll(perf_midi_smooth, shift_est)
            if shift_est > 0:
                perf_midi_shifted[:shift_est] = 0
            elif shift_est < 0:
                perf_midi_shifted[shift_est:] = 0

            similarity_score = self.calculate_curve_similarity(
                self.ref_midi_smooth,
                perf_midi_shifted
            )
            
            return {
                'melody_score': similarity_score,
                'final_score': similarity_score
            }
            
        except Exception as e:
            print(f"Error calculating score: {e}")
            return {'melody_score': 0.0, 'final_score': 0.0}

    # [Previous helper methods remain unchanged]
    def convert_to_midi(self, f0):
        return np.where(f0 > 0, librosa.hz_to_midi(f0), 0)

    def normalize_to_octave(self, midi_notes):
        silence_mask = (midi_notes == 0)
        normalized = np.where(
            ~silence_mask,
            ((midi_notes - 60) % 12) + 60,
            0
        )
        return normalized

    def get_smooth_pitch_curve(self, midi_notes):
        silence_mask = (midi_notes == 0)
        valid_indices = ~silence_mask
        if np.any(valid_indices):
            x = np.arange(len(midi_notes))
            y = midi_notes.copy()
            segments = np.split(y, np.where(np.diff(valid_indices))[0] + 1)
            segment_indices = np.split(x, np.where(np.diff(valid_indices))[0] + 1)
            smooth_curve = np.zeros_like(midi_notes)

            for seg, idx in zip(segments, segment_indices):
                if np.any(seg != 0):
                    if len(seg) >= 5:
                        window_length = min(5, len(seg) - 2)
                        if window_length % 2 == 0:
                            window_length -= 1
                        if window_length >= 3:
                            seg_smoothed = savgol_filter(seg, window_length, 2)
                            smooth_curve[idx] = seg_smoothed
                        else:
                            smooth_curve[idx] = seg
                    else:
                        smooth_curve[idx] = seg
            return smooth_curve
        return np.zeros_like(midi_notes)

    def calculate_curve_similarity(self, curve1, curve2):
        # Ensure curves have same length before comparison
        min_len = min(len(curve1), len(curve2))
        curve1 = curve1[:min_len]
        curve2 = curve2[:min_len]
        
        silence_mask1 = (curve1 == 0)
        silence_mask2 = (curve2 == 0)
        valid_mask = ~silence_mask1 & ~silence_mask2

        if not np.any(valid_mask):
            return 0.0

        curve1_clean = curve1[valid_mask]
        curve2_clean = curve2[valid_mask]

        if len(curve1_clean) < 2 or len(curve2_clean) < 2:
            return 0.0

        max_points = 1000
        if len(curve1_clean) > max_points:
            step = len(curve1_clean) // max_points
            curve1_clean = curve1_clean[::step]
            curve2_clean = curve2_clean[::step]

        try:
            distance, _ = fastdtw(
                curve1_clean.reshape(-1, 1),
                curve2_clean.reshape(-1, 1),
                dist=lambda a, b: circular_semitone_distance(a[0], b[0]),
                radius=10
            )
        except Exception as e:
            return 0.0

        max_distance = 6 * len(curve1_clean)
        raw_similarity = max(0, 100 * (1 - distance / max_distance))

        ref_voiced_mask = ~silence_mask1
        perf_voiced_mask = ~silence_mask2
        both_voiced = ref_voiced_mask & perf_voiced_mask

        overlap_fraction = (np.sum(both_voiced) / np.sum(ref_voiced_mask) 
                          if np.sum(ref_voiced_mask) > 0 else 1.0)

        min_similarity = 30
        max_similarity = 90
        scaled_min = 0
        scaled_max = 100

        if raw_similarity <= min_similarity:
            scaled_similarity = scaled_min
        elif raw_similarity >= max_similarity:
            scaled_similarity = scaled_max
        else:
            scaled_similarity = (scaled_min + 
                               ((raw_similarity - min_similarity) /
                                (max_similarity - min_similarity)) * 
                               (scaled_max - scaled_min))

        weighted_similarity = scaled_similarity * overlap_fraction
        final_score = weighted_similarity * 1.11
        
        return final_score

    def estimate_shift_via_xcorr(self, ref_curve, perf_curve):
        ref = ref_curve.astype(np.float32)
        perf = perf_curve.astype(np.float32)
        n = len(ref)
        N = 1
        while N < 2 * n:
            N *= 2

        F_ref = rfft(ref, N)
        F_perf = rfft(perf, N)
        cc = irfft(F_ref * np.conjugate(F_perf), N)
        cc = np.concatenate((cc[-(n-1):], cc[:n]))
        shift = np.argmax(cc) - (n - 1)
        return shift

def main():
    if len(sys.argv) != 3:
        print("Usage: python scoring.py <reference_vocals.wav> <performance_audio>")
        sys.exit(1)
        
    reference_path = sys.argv[1]
    performance_path = sys.argv[2]
    
    scorer = KaraokeScorer(reference_path)
    scores = scorer.score_performance_file(performance_path)
    
    print(f"{scores['final_score']:.1f}", file=sys.stderr)

if __name__ == "__main__":
    main()