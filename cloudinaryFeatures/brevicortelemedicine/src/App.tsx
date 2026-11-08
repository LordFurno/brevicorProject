import { useState } from 'react';
import { MeetingRoom } from './components/MeetingRoom';
import { PatientWaitingRoom } from './components/PatientWaitingRoom';
import { uploadPreset as initialPreset } from './cloudinary/config';
import type { PreVisitPhoto } from './types';
import './App.css';

export function App() {
  const [currentView, setCurrentView] = useState<'meeting' | 'waiting_room'>('meeting');
  const [cloudName] = useState(import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'hqhfgx5c');
  const [uploadPreset] = useState(initialPreset || 'ml_default');

  // Pre-visit photos uploaded in waiting room
  const [preVisitPhotos, setPreVisitPhotos] = useState<PreVisitPhoto[]>([
    {
      id: 'pre_init_1',
      public_id: 'samples/food/spices',
      secure_url: 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?auto=format&fit=crop&w=600&q=80',
      uploaded_at: '6:18 PM',
      title: 'Erythematous Forearm Rash (Day 2)',
      category: 'Patient Pre-Visit Intake',
      notes: 'Noticed spreading border after gardening.',
    },
  ]);

  const handleAddPreVisitPhoto = (photo: PreVisitPhoto) => {
    setPreVisitPhotos((prev) => [photo, ...prev]);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {currentView === 'waiting_room' ? (
        <PatientWaitingRoom
          onJoinCall={() => setCurrentView('meeting')}
          preVisitPhotos={preVisitPhotos}
          onAddPreVisitPhoto={handleAddPreVisitPhoto}
          cloudName={cloudName}
          uploadPreset={uploadPreset}
        />
      ) : (
        <MeetingRoom
          onSwitchToWaitingRoom={() => setCurrentView('waiting_room')}
          preVisitPhotos={preVisitPhotos}
        />
      )}
    </div>
  );
}

export default App;
