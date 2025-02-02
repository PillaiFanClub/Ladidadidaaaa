import librosa
import numpy as np
import sounddevice as sd
import soundfile as sf
import pygame
import time
import os
import pickle
from pathlib import Path
from scipy.signal import savgol_filter
from fastdtw import fastdtw
from scipy.spatial.distance import euclidean
from numpy.fft import rfft, irfft
import multiprocessing
from functools import partial

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

class ProjectPaths:
    def __init__(self):
        self.script_dir = Path(__file__).parent
        self.project_root = self.script_dir.parent
        self.assets_dir = self.project_root / "assets"
        self.vocals_dir = self.assets_dir / "reference_vocals"
        self.instrumental_dir = self.assets_dir / "reference_instrumental"
        self.recordings_dir = self.project_root / "recordings"
        self.cache_dir = self.project_root / "cache"
        
        self.recordings_dir.mkdir(exist_ok=True)
        self.cache_dir.mkdir(exist_ok=True)
    
    def get_song_paths(self, song_id):
        return {
            "vocals": self.vocals_dir / f"{song_id}_Vocal.wav",
            "instrumental": self.instrumental_dir / f"{song_id}_Instrumental.wav"
        }
    
    def get_recording_path(self, timestamp):
        return self.recordings_dir / f"recording_{timestamp}.wav"

class ReferenceCache:
    def __init__(self, cache_dir):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)
        
    def _get_cache_path(self, reference_path):
        reference_filename = Path(reference_path).stem
        cache_path = self.cache_dir / f"{reference_filename}_cache.pkl"
        print(f"Cache path: {cache_path}")
        return cache_path
    
    def get_cached_analysis(self, reference_path):
        cache_path = self._get_cache_path(reference_path)
        if cache_path.exists():
            print(f"Found existing cache file")
            try:
                with open(cache_path, 'rb') as f:
                    cached_data = pickle.load(f)
                    print("Successfully loaded cached analysis")
                    return cached_data
            except Exception as e:
                print(f"Error loading cache: {e}")
                return None
        else:
            print("No existing cache found - will create new cache")
            return None
    
    def cache_analysis(self, reference_path, analysis_data):
        cache_path = self._get_cache_path(reference_path)
        print(f"Caching analysis for {reference_path}")
        try:
            with open(cache_path, 'wb') as f:
                pickle.dump(analysis_data, f)
        except Exception as e:
            print(f"Error saving cache: {e}")

class KaraokeScorer:
    def __init__(self, vocals_path, instrumental_path, project_paths):
        self.sample_rate = 44100
        self.instrumental_path = instrumental_path
        self.vocals_path = vocals_path
        self.project_paths = project_paths
        
        self.frame_length = 2048
        self.hop_length = self.frame_length // 4
        
        duration = librosa.get_duration(path=str(instrumental_path))
        self.record_duration = int(duration)
        print(f"Song duration: {self.record_duration} seconds")
        
        pygame.mixer.init(frequency=self.sample_rate, size=-16, channels=2)
        self.cache = ReferenceCache(project_paths.cache_dir)
        
        cached_data = self.cache.get_cached_analysis(vocals_path)
        if cached_data:
            self._load_cached_data(cached_data)
        else:
            self._analyze_reference_vocals()
    
    def _load_cached_data(self, cached_data):
        self.reference_audio = cached_data['reference_audio']
        self.ref_f0 = cached_data['ref_f0']
        self.ref_midi = cached_data['ref_midi']
        self.ref_midi_norm = cached_data['ref_midi_norm']
        self.ref_midi_smooth = cached_data['ref_midi_smooth']
        print("Successfully loaded cached reference analysis")
        
    def _analyze_reference_vocals(self):
        print("Loading reference vocals...")
        self.reference_audio, _ = librosa.load(
            str(self.vocals_path),
            sr=self.sample_rate,
            duration=self.record_duration,
            mono=True
        )

        print("Analyzing reference pitch...")
        chunk_size = self.sample_rate * 10
        chunks = [self.reference_audio[i:i + chunk_size] 
                 for i in range(0, len(self.reference_audio), chunk_size)]

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
        
        cache_data = {
            'reference_audio': self.reference_audio,
            'ref_f0': self.ref_f0,
            'ref_midi': self.ref_midi,
            'ref_midi_norm': self.ref_midi_norm,
            'ref_midi_smooth': self.ref_midi_smooth
        }
        self.cache.cache_analysis(self.vocals_path, cache_data)
        
        print("Reference analysis complete and cached")
        print(f"Reference f0 non-zero frames: {np.count_nonzero(self.ref_f0)}")
        print(f"Reference MIDI non-zero frames: {np.count_nonzero(self.ref_midi)}")

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
            print("No overlapping voiced frames. Similarity = 0%.")
            return 0.0

        curve1_clean = curve1[valid_mask]
        curve2_clean = curve2[valid_mask]

        if len(curve1_clean) < 2 or len(curve2_clean) < 2:
            print("Not enough valid points for comparison. Similarity = 0%.")
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
            print(f"Error calculating DTW distance: {e}")
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

        print(f"Raw DTW distance = {distance:.2f}")
        print(f"Raw Similarity (no overlap factor) = {raw_similarity:.1f}%")
        print(f"Overlap fraction (vs reference) = {overlap_fraction:.3f}")
        print(f"Scaled Similarity = {scaled_similarity:.1f}%")
        print(f"Weighted Similarity = {weighted_similarity:.1f}%")
        print(f"Final Score = {final_score:.1f}%")
        
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

    def record_performance(self):
        print("\nGet ready to sing!")
        for i in range(3, 0, -1):
            print(f"{i}...")
            time.sleep(1)
        
        print("Recording started!")
        try:
            # pygame.mixer.music.load(str(self.instrumental_path))
            # pygame.mixer.music.play()

            recording = sd.rec(
                int(self.record_duration * self.sample_rate),
                samplerate=self.sample_rate,
                channels=1
            )
            
            try:
                time.sleep(self.record_duration)
            except KeyboardInterrupt:
                print("\nRecording stopped early!")
                sd.stop()
                # pygame.mixer.music.stop()
                # pygame.mixer.quit()
                return None  # Return None to indicate cancelled recording
            
            pygame.mixer.music.stop()
            sd.stop()
            
            timestamp = time.strftime("%Y%m%d-%H%M%S")
            output_file = self.project_paths.get_recording_path(timestamp)
            sf.write(str(output_file), recording, self.sample_rate)
            
            return recording.flatten()
            
        except Exception as e:
            print(f"Error during recording: {e}")
            # pygame.mixer.quit()
            return None

    def calculate_score(self, performance_audio):
        if performance_audio is None:
            print("Recording was cancelled.")
            return {'melody_score': 0.0, 'final_score': 0.0}
            
        print("\nAnalyzing your performance...")
        
        try:
            chunk_size = self.sample_rate * 10  # 10-second chunks
            chunks = [performance_audio[i:i + chunk_size] 
                     for i in range(0, len(performance_audio), chunk_size)]

            with multiprocessing.Pool() as pool:
                process_chunk = partial(
                    process_audio_chunk,
                    sr=self.sample_rate,
                    frame_length=self.frame_length,
                    hop_length=self.hop_length
                )
                results = pool.map(process_chunk, chunks)

            # Combine results and handle potential errors
            perf_f0 = np.concatenate([r[0] for r in results])
            
            if np.all(perf_f0 == 0):
                print("No vocal input detected.")
                return {'melody_score': 0.0, 'final_score': 0.0}

            perf_midi = self.convert_to_midi(perf_f0)
            
            print("Performance f0 non-zero frames:", np.count_nonzero(perf_f0))
            print("Performance MIDI non-zero frames:", np.count_nonzero(perf_midi))

            perf_midi_norm = self.normalize_to_octave(perf_midi)
            perf_midi_smooth = self.get_smooth_pitch_curve(perf_midi_norm)

            shift_est = self.estimate_shift_via_xcorr(self.ref_midi_smooth, perf_midi_smooth)
            print(f"Estimated shift (via xcorr): {shift_est} frames")

            perf_midi_shifted = np.roll(perf_midi_smooth, shift_est)
            if shift_est > 0:
                perf_midi_shifted[:shift_est] = 0
            elif shift_est < 0:
                perf_midi_shifted[shift_est:] = 0

            similarity_score = self.calculate_curve_similarity(
                self.ref_midi_smooth,
                perf_midi_shifted
            )
            
            return {'melody_score': similarity_score, 'final_score': similarity_score}
            
        except Exception as e:
            print(f"Error calculating score: {e}")
            return {'melody_score': 0.0, 'final_score': 0.0}

def main():
    try:
        # Initialize project paths
        paths = ProjectPaths()
        
        # Define available songs
        songs = {
            "DieWithASmile": {
                "vocals": paths.vocals_dir / "DieWithASmile_Vocal.wav",
                "instrumental": paths.instrumental_dir / "DieWithASmile_Instrumental.wav"
            }
        }
        
        song_key = "DieWithASmile"
        
        # Verify that the song files exist
        if not songs[song_key]["vocals"].exists():
            raise FileNotFoundError(f"Vocals file not found: {songs[song_key]['vocals']}")
        if not songs[song_key]["instrumental"].exists():
            raise FileNotFoundError(f"Instrumental file not found: {songs[song_key]['instrumental']}")
        
        scorer = KaraokeScorer(
            vocals_path=songs[song_key]["vocals"],
            instrumental_path=songs[song_key]["instrumental"],
            project_paths=paths
        )
        
        performance = scorer.record_performance()
        if performance is not None:
            scores = scorer.calculate_score(performance)
            print("\nFinal Scores:")
            print(f"Melody Similarity Score: {scores['melody_score']:.1f}%")
        else:
            print("\nRecording cancelled. No score calculated.")
            
    except Exception as e:
        print(f"An error occurred: {e}")
        
    finally:
        # Ensure pygame is properly cleaned up
        try:
            pygame.mixer.quit()
            pygame.quit()
        except:
            pass

if __name__ == "__main__":
    main()