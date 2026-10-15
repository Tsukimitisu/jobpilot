// Entirely synthetic. These URLs are identifiers only; tests never fetch them.
export const alerts = [
  {provider:'LinkedIn',body:'<a href="https://www.linkedin.com/jobs/view/123?utm_source=email">Junior Developer</a>'},
  {provider:'Indeed',body:'<a href="https://ph.indeed.com/viewjob?jk=fixture123">Support Engineer</a>'},
  {provider:'JobStreet',body:'<a href="https://ph.jobstreet.com/job/123">QA Engineer</a>'},
  {provider:'Glassdoor',body:'<a href="https://www.glassdoor.com/job-listing/fixture?jobListingId=123">Data Analyst</a>'},
  {provider:'Kalibrr',body:'<a href="https://www.kalibrr.com/c/fixture/jobs/unused">Unrecognized listing</a><a href="https://www.kalibrr.com/c/fixture/job/123/analyst">Analyst</a>'},
  {provider:'Bossjob',body:'<a href="https://bossjob.ph/job/fixture-123">Office Assistant</a>'},
]
export const explicitAlert = 'Title: Junior Developer\nCompany: Fixture Company\nLocation: Cebu\nWork mode: remote\nRequired skills: TypeScript\nExperience required: 1 year\nEmployment type: full-time\nSalary: PHP 30,000 per month\nURL: https://example.invalid/roles/123'
