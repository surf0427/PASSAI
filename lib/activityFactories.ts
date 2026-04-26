import type {
  ClubActivity,
  VolunteerActivity,
  StudyAbroadActivity,
  ResearchActivity,
  PartTimeJobActivity,
  CertificationActivity,
  ContestActivity,
  ReadingActivity,
  HobbyActivity,
} from '@/types/activity';

export function newClubActivity(): ClubActivity {
  return {
    type: 'club',
    clubName: '', sport: '', competitionLevel: '', teamSize: '',
    period: { from: '', to: '' },
    description: '', achievement: '', role: '',
    challenge: '', action: '', reflection: '', futureConnection: '',
  };
}
export function newVolunteerActivity(): VolunteerActivity {
  return {
    type: 'volunteer',
    activityContent: '', target: '', purpose: '', frequency: '',
    period: { from: '', to: '' },
    description: '', achievement: '', role: '',
    challenge: '', action: '', reflection: '', futureConnection: '',
  };
}
export function newStudyAbroadActivity(): StudyAbroadActivity {
  return {
    type: 'studyAbroad',
    destination: '', programContent: '', language: '',
    period: { from: '', to: '' },
    description: '', achievement: '', role: '',
    challenge: '', action: '', reflection: '', futureConnection: '',
  };
}
export function newResearchActivity(): ResearchActivity {
  return {
    type: 'research',
    theme: '', trigger: '', hypothesis: '', methodology: '', output: '',
    period: { from: '', to: '' },
    description: '', achievement: '', role: '',
    challenge: '', action: '', reflection: '', futureConnection: '',
  };
}
export function newPartTimeJobActivity(): PartTimeJobActivity {
  return {
    type: 'partTimeJob',
    industry: '', jobContent: '', workFrequency: '',
    period: { from: '', to: '' },
    description: '', achievement: '', role: '',
    challenge: '', action: '', reflection: '', futureConnection: '',
  };
}
export function newCertificationActivity(): CertificationActivity {
  return {
    type: 'certification',
    certificationName: '', level: '', acquiredDate: '', purpose: '',
    studyMethod: '', difficulty: '', reflection: '', futureConnection: '',
  };
}
export function newContestActivity(): ContestActivity {
  return {
    type: 'contest',
    contestName: '', field: '', result: '',
    period: { from: '', to: '' },
    description: '', achievement: '', role: '',
    challenge: '', action: '', reflection: '', futureConnection: '',
  };
}
export function newReadingActivity(): ReadingActivity {
  return {
    type: 'reading',
    genre: '', favoriteBook: '', reason: '', reflection: '', mindChange: '',
  };
}
export function newHobbyActivity(): HobbyActivity {
  return {
    type: 'hobby',
    hobbyContent: '', frequency: '', reason: '', innovation: '', acquiredSkills: '',
  };
}
