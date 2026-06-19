import { InstanceMetrics } from '../analyzers/idle_ec2';

export interface IEC2Connector {
  listInstances(): Promise<InstanceMetrics[]>;
}
