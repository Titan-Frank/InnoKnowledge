export interface Framework {
  framework_id?: string;
  title?: string;
  domains: FrameworkDomain[];
}

export interface FrameworkDomain {
  [key: string]: unknown;
  id: string;
  title: string;
  topics: FrameworkTopic[];
}

export interface FrameworkTopic {
  id: string;
  title: string;
  expectations: FrameworkExpectation[];
}

export interface FrameworkExpectation {
  id: string;
  text: string;
}
